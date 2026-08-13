import type { SupabaseClient } from '@supabase/supabase-js';

import { AppError } from '../errors/app-error.ts';
import type {
  ClassifiableTransaction,
  ClassificationResult,
  ExistingMatch,
  ProposedMatch,
  TransactionRule,
} from '../financial/types.ts';
import type { PlaidTransaction } from '../plaid/types.ts';

/**
 * Transaction persistence.
 *
 * Idempotency lives here. Every write keys off `plaid_transaction_id`, so
 * replaying a sync page — which happens whenever a run fails after fetching but
 * before committing the cursor — updates rows in place rather than duplicating
 * them.
 */
export class TransactionRepository {
  constructor(private readonly client: SupabaseClient) {}

  /**
   * Applies added and modified transactions.
   *
   * Both use the same upsert: Plaid's `modified` list frequently contains rows
   * we have never seen (a transaction that changed before we first synced), and
   * `added` can contain rows we already have (a replayed page). Treating them
   * identically is what makes replay safe.
   *
   * Only Plaid-owned columns are written. `user_type` and friends are absent
   * from the payload, so a sync can never clobber a user's classification.
   */
  async upsertFromPlaid(input: {
    userId: string;
    transactions: PlaidTransaction[];
    accountIdByPlaidId: Map<string, string>;
  }): Promise<{ written: number; skipped: number }> {
    if (input.transactions.length === 0) return { written: 0, skipped: 0 };

    const rows: Record<string, unknown>[] = [];
    let skipped = 0;

    for (const transaction of input.transactions) {
      const accountId = input.accountIdByPlaidId.get(transaction.account_id);
      if (!accountId) {
        // A transaction on an account we have not imported yet. The accounts
        // sync runs first, so this is rare; skipping is safer than inventing
        // an account row from partial data.
        skipped += 1;
        continue;
      }

      rows.push({
        user_id: input.userId,
        account_id: accountId,
        plaid_transaction_id: transaction.transaction_id,
        plaid_pending_transaction_id: transaction.pending_transaction_id,
        posted_date: transaction.date,
        authorized_date: transaction.authorized_date,
        datetime: transaction.datetime,
        name: transaction.name,
        merchant_name: transaction.merchant_name,
        amount: transaction.amount,
        iso_currency_code: transaction.iso_currency_code,
        unofficial_currency_code: transaction.unofficial_currency_code,
        pending: transaction.pending,
        plaid_category_primary: transaction.personal_finance_category?.primary ?? null,
        plaid_category_detailed: transaction.personal_finance_category?.detailed ?? null,
        plaid_category_confidence: transaction.personal_finance_category?.confidence_level ?? null,
        plaid_payment_channel: transaction.payment_channel,
        plaid_transaction_code: transaction.transaction_code,
        website_url: transaction.website,
        logo_url: transaction.logo_url,
        // A row previously removed and then re-sent by Plaid is restored.
        removed_at: null,
      });
    }

    if (rows.length === 0) return { written: 0, skipped };

    // Chunked to stay within statement size limits on large initial imports.
    for (const chunk of chunkRows(rows, 250)) {
      const { error } = await this.client
        .from('transactions')
        .upsert(chunk, { onConflict: 'plaid_transaction_id' });
      if (error) throw AppError.database('upsertTransactions', error.message);
    }

    return { written: rows.length, skipped };
  }

  /**
   * Retires pending transactions that have posted.
   *
   * When a pending transaction posts, Plaid sends a new posted transaction
   * whose `pending_transaction_id` points at the old one. Marking the pending
   * row removed is what stops one purchase being counted twice — belt and
   * braces alongside aggregates excluding pending rows entirely.
   */
  async retireSupersededPending(
    userId: string,
    transactions: PlaidTransaction[],
  ): Promise<number> {
    const supersededIds = transactions
      .map((transaction) => transaction.pending_transaction_id)
      .filter((id): id is string => Boolean(id));

    if (supersededIds.length === 0) return 0;

    const { data, error } = await this.client
      .from('transactions')
      .update({ removed_at: new Date().toISOString() })
      .eq('user_id', userId)
      .in('plaid_transaction_id', supersededIds)
      .is('removed_at', null)
      .select('id');

    if (error) throw AppError.database('retirePendingTransactions', error.message);
    return (data as { id: string }[]).length;
  }

  /**
   * Applies Plaid removals as a soft delete.
   *
   * Financial views filter removed rows out, so the effect on every figure is
   * identical to a hard delete, but the history stays auditable.
   */
  async markRemoved(userId: string, plaidTransactionIds: string[]): Promise<number> {
    if (plaidTransactionIds.length === 0) return 0;

    let removed = 0;
    for (const chunk of chunkRows(plaidTransactionIds, 250)) {
      const { data, error } = await this.client
        .from('transactions')
        .update({ removed_at: new Date().toISOString(), transfer_match_id: null })
        .eq('user_id', userId)
        .in('plaid_transaction_id', chunk)
        .is('removed_at', null)
        .select('id');

      if (error) throw AppError.database('markTransactionsRemoved', error.message);
      removed += (data as { id: string }[]).length;
    }

    return removed;
  }

  /** Transactions needing classification, with the context to classify them. */
  async listForClassification(
    userId: string,
    sinceDate: string,
  ): Promise<ClassifiableTransaction[]> {
    const { data, error } = await this.client
      .from('transactions')
      .select(
        'id, account_id, posted_date, name, merchant_name, amount, iso_currency_code, unofficial_currency_code, pending, plaid_category_primary, plaid_category_detailed',
      )
      .eq('user_id', userId)
      .is('removed_at', null)
      .gte('posted_date', sinceDate)
      .order('posted_date', { ascending: false })
      .limit(5000);

    if (error) throw AppError.database('listForClassification', error.message);

    return (
      data as {
        id: string;
        account_id: string;
        posted_date: string;
        name: string;
        merchant_name: string | null;
        amount: number;
        iso_currency_code: string | null;
        unofficial_currency_code: string | null;
        pending: boolean;
        plaid_category_primary: string | null;
        plaid_category_detailed: string | null;
      }[]
    ).map((row) => ({
      id: row.id,
      accountId: row.account_id,
      postedDate: row.posted_date,
      name: row.name,
      merchantName: row.merchant_name,
      amount: Number(row.amount),
      currency: row.iso_currency_code ?? row.unofficial_currency_code,
      pending: row.pending,
      plaidCategoryPrimary: row.plaid_category_primary,
      plaidCategoryDetailed: row.plaid_category_detailed,
    }));
  }

  /**
   * Writes system classifications.
   *
   * Touches `system_*` columns only. A user override is stored in different
   * columns and takes precedence in the view, so re-classifying everything is
   * always safe.
   */
  async applyClassifications(
    results: { transactionId: string; result: ClassificationResult }[],
  ): Promise<number> {
    if (results.length === 0) return 0;

    const now = new Date().toISOString();
    let written = 0;

    for (const chunk of chunkRows(results, 100)) {
      await Promise.all(
        chunk.map(async ({ transactionId, result }) => {
          const { error } = await this.client
            .from('transactions')
            .update({
              system_type: result.type,
              system_transfer_subtype: result.type === 'TRANSFER' ? result.transferSubtype : null,
              system_classification_reason: result.reason,
              system_classified_at: now,
            })
            .eq('id', transactionId);

          if (error) throw AppError.database('applyClassification', error.message);
        }),
      );
      written += chunk.length;
    }

    return written;
  }

  async listRules(userId: string): Promise<TransactionRule[]> {
    const { data, error } = await this.client
      .from('transaction_rules')
      .select('*')
      .eq('user_id', userId)
      .eq('enabled', true)
      .order('priority')
      .order('created_at');

    if (error) throw AppError.database('listRules', error.message);

    return (
      data as {
        id: string;
        name: string;
        enabled: boolean;
        priority: number;
        created_at: string;
        match_field: TransactionRule['matchField'];
        match_operator: TransactionRule['matchOperator'];
        match_value: string;
        min_amount: number | null;
        max_amount: number | null;
        account_id: string | null;
        result_type: TransactionRule['resultType'];
        result_transfer_subtype: TransactionRule['resultTransferSubtype'];
      }[]
    ).map((row) => ({
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      priority: row.priority,
      createdAt: row.created_at,
      matchField: row.match_field,
      matchOperator: row.match_operator,
      matchValue: row.match_value,
      minAmount: row.min_amount === null ? null : Number(row.min_amount),
      maxAmount: row.max_amount === null ? null : Number(row.max_amount),
      accountId: row.account_id,
      resultType: row.result_type,
      resultTransferSubtype: row.result_transfer_subtype,
    }));
  }

  // -------------------------------------------------------------------------
  // Transfer matches
  // -------------------------------------------------------------------------

  async listExistingMatches(userId: string): Promise<ExistingMatch[]> {
    const { data, error } = await this.client
      .from('transfer_matches')
      .select('outgoing_transaction_id, incoming_transaction_id, status')
      .eq('user_id', userId);

    if (error) throw AppError.database('listExistingMatches', error.message);

    return (
      data as {
        outgoing_transaction_id: string;
        incoming_transaction_id: string;
        status: ExistingMatch['status'];
      }[]
    ).map((row) => ({
      outgoingTransactionId: row.outgoing_transaction_id,
      incomingTransactionId: row.incoming_transaction_id,
      status: row.status,
    }));
  }

  /**
   * Persists newly detected matches.
   *
   * Auto-matched pairs also get TRANSFER written to `system_type` on both legs,
   * which is what removes them from spending. Pairs needing review are recorded
   * WITHOUT touching classification, so they keep counting as spending until a
   * human confirms them.
   */
  async saveProposedMatches(userId: string, matches: ProposedMatch[]): Promise<number> {
    if (matches.length === 0) return 0;

    for (const match of matches) {
      const { data, error } = await this.client
        .from('transfer_matches')
        .upsert(
          {
            user_id: userId,
            outgoing_transaction_id: match.outgoingTransactionId,
            incoming_transaction_id: match.incomingTransactionId,
            confidence: match.confidence,
            detection_method: match.detectionMethod,
            reason: match.reasons,
            subtype: match.subtype,
            status: match.status,
          },
          { onConflict: 'outgoing_transaction_id,incoming_transaction_id' },
        )
        .select('id')
        .single();

      if (error) throw AppError.database('saveTransferMatch', error.message);
      const matchId = (data as { id: string }).id;

      if (match.status === 'AUTO_MATCHED') {
        const { error: updateError } = await this.client
          .from('transactions')
          .update({
            transfer_match_id: matchId,
            system_type: 'TRANSFER',
            system_transfer_subtype: match.subtype,
            system_classification_reason: `transfer_match:${match.detectionMethod}:${match.confidence}`,
            system_classified_at: new Date().toISOString(),
          })
          .eq('user_id', userId)
          .in('id', [match.outgoingTransactionId, match.incomingTransactionId]);

        if (updateError) throw AppError.database('applyTransferMatch', updateError.message);
      } else {
        // Link the transactions to the match so the UI can surface it, but
        // leave classification alone.
        const { error: linkError } = await this.client
          .from('transactions')
          .update({ transfer_match_id: matchId })
          .eq('user_id', userId)
          .in('id', [match.outgoingTransactionId, match.incomingTransactionId])
          .is('transfer_match_id', null);

        if (linkError) throw AppError.database('linkTransferMatch', linkError.message);
      }
    }

    return matches.length;
  }
}

function chunkRows<T>(rows: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}
