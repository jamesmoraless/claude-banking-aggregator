import type { SupabaseClient } from '@supabase/supabase-js';

import { AppError } from '../errors/app-error.ts';
import { defaultIncludeInCash } from '../financial/classification.ts';
import type { AccountContext } from '../financial/types.ts';
import type { PlaidAccount } from '../plaid/types.ts';

/**
 * Account persistence.
 *
 * The central rule: sync owns what the bank owns, the user owns everything
 * else. `include_in_cash`, `include_in_net_worth`, `hidden` and `display_name`
 * are written on first insert and never touched again, so a nightly sync can
 * never quietly undo a user's reporting choices.
 */
export class AccountRepository {
  constructor(private readonly client: SupabaseClient) {}

  async upsertFromPlaid(input: {
    userId: string;
    itemId: string;
    institutionId: string | null;
    accounts: PlaidAccount[];
  }): Promise<{ inserted: number; updated: number; accountIds: string[] }> {
    if (input.accounts.length === 0) return { inserted: 0, updated: 0, accountIds: [] };

    const plaidAccountIds = input.accounts.map((account) => account.account_id);

    const { data: existingRows, error: existingError } = await this.client
      .from('accounts')
      .select('id, plaid_account_id')
      .in('plaid_account_id', plaidAccountIds);

    if (existingError) throw AppError.database('findExistingAccounts', existingError.message);

    const existingByPlaidId = new Map(
      (existingRows as { id: string; plaid_account_id: string }[]).map((row) => [
        row.plaid_account_id,
        row.id,
      ]),
    );

    const now = new Date().toISOString();
    const accountIds: string[] = [];
    let inserted = 0;
    let updated = 0;

    for (const account of input.accounts) {
      const existingId = existingByPlaidId.get(account.account_id);

      // Columns Plaid owns. Applied on both insert and update.
      const bankOwned = {
        name: account.name,
        official_name: account.official_name,
        mask: account.mask,
        type: account.type,
        subtype: account.subtype,
        current_balance: account.balances.current,
        available_balance: account.balances.available,
        credit_limit: account.balances.limit,
        iso_currency_code: account.balances.iso_currency_code,
        unofficial_currency_code: account.balances.unofficial_currency_code,
        balances_updated_at: now,
        last_synced_at: now,
      };

      if (existingId) {
        const { error } = await this.client
          .from('accounts')
          .update(bankOwned)
          .eq('id', existingId);
        if (error) throw AppError.database('updateAccount', error.message);

        accountIds.push(existingId);
        updated += 1;
        continue;
      }

      const context: AccountContext = {
        id: '',
        type: account.type,
        subtype: account.subtype,
        institutionId: input.institutionId,
        currency: account.balances.iso_currency_code,
      };

      const { data, error } = await this.client
        .from('accounts')
        .insert({
          user_id: input.userId,
          institution_id: input.institutionId,
          plaid_item_id: input.itemId,
          plaid_account_id: account.account_id,
          source: 'plaid',
          ...bankOwned,
          // User-owned defaults, applied once and then left alone.
          include_in_cash: defaultIncludeInCash(context),
          include_in_net_worth: true,
          hidden: false,
        })
        .select('id')
        .single();

      if (error) throw AppError.database('insertAccount', error.message);

      accountIds.push((data as { id: string }).id);
      inserted += 1;
    }

    return { inserted, updated, accountIds };
  }

  /**
   * Records a balance snapshot per account.
   *
   * Unique per account per UTC day, so re-running a sync updates the day's row
   * instead of littering history with near-identical points.
   */
  async recordSnapshots(input: {
    userId: string;
    accounts: { accountId: string; plaidAccount: PlaidAccount }[];
  }): Promise<number> {
    if (input.accounts.length === 0) return 0;

    const rows = input.accounts.map(({ accountId, plaidAccount }) => ({
      user_id: input.userId,
      account_id: accountId,
      current_balance: plaidAccount.balances.current,
      available_balance: plaidAccount.balances.available,
      credit_limit: plaidAccount.balances.limit,
      iso_currency_code: plaidAccount.balances.iso_currency_code,
      captured_at: new Date().toISOString(),
    }));

    const { error } = await this.client
      .from('balance_snapshots')
      .upsert(rows, { onConflict: 'account_id,captured_date' });

    if (error) throw AppError.database('recordSnapshots', error.message);
    return rows.length;
  }

  /** Account context for classification and transfer detection. */
  async listContexts(userId: string): Promise<AccountContext[]> {
    const { data, error } = await this.client
      .from('accounts')
      .select('id, type, subtype, institution_id, iso_currency_code, unofficial_currency_code')
      .eq('user_id', userId);

    if (error) throw AppError.database('listAccountContexts', error.message);

    return (
      data as {
        id: string;
        type: string;
        subtype: string | null;
        institution_id: string | null;
        iso_currency_code: string | null;
        unofficial_currency_code: string | null;
      }[]
    ).map((row) => ({
      id: row.id,
      type: row.type,
      subtype: row.subtype,
      institutionId: row.institution_id,
      currency: row.iso_currency_code ?? row.unofficial_currency_code,
    }));
  }

  /** Maps Plaid account ids to our ids, for attaching transactions. */
  async mapPlaidAccountIds(userId: string): Promise<Map<string, string>> {
    const { data, error } = await this.client
      .from('accounts')
      .select('id, plaid_account_id')
      .eq('user_id', userId)
      .not('plaid_account_id', 'is', null);

    if (error) throw AppError.database('mapPlaidAccountIds', error.message);

    return new Map(
      (data as { id: string; plaid_account_id: string }[]).map((row) => [
        row.plaid_account_id,
        row.id,
      ]),
    );
  }
}
