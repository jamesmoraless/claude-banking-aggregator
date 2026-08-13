import type { SupabaseClient } from '@supabase/supabase-js';

import { classifyTransaction } from '../financial/classification.ts';
import { detectTransfers } from '../financial/transfer-detection.ts';
import type { AccountContext, ClassificationResult } from '../financial/types.ts';
import type { Logger } from '../logging/logger.ts';
import { AccountRepository } from '../repositories/account-repository.ts';
import { SyncRunRepository } from '../repositories/sync-run-repository.ts';
import { TransactionRepository } from '../repositories/transaction-repository.ts';

/**
 * Normalisation: classification followed by transfer detection.
 *
 * Runs after every transaction sync, over the window the sync touched. It is
 * safe to run repeatedly — classification is a pure function of the
 * transaction, its account and the user's rules, and transfer detection skips
 * pairs it has already seen.
 *
 * Order matters. Classification identifies transfer *candidates*; detection
 * then uses those candidates as a prior and, where it finds a counterpart,
 * upgrades the pair to an actual TRANSFER. Running detection first would have
 * no candidate signal to work with.
 */

export type NormalizationResult = {
  classified: number;
  transfersDetected: number;
  transfersNeedingReview: number;
};

export class NormalizationService {
  private readonly transactions: TransactionRepository;
  private readonly accounts: AccountRepository;
  private readonly syncRuns: SyncRunRepository;

  constructor(
    client: SupabaseClient,
    private readonly logger: Logger,
  ) {
    this.transactions = new TransactionRepository(client);
    this.accounts = new AccountRepository(client);
    this.syncRuns = new SyncRunRepository(client, logger);
  }

  async run(input: {
    userId: string;
    sinceDate: string;
    requestId: string;
  }): Promise<NormalizationResult> {
    const startedAt = Date.now();
    const runId = await this.syncRuns.start({
      userId: input.userId,
      itemId: null,
      operation: 'TRANSFER_DETECTION',
      requestId: input.requestId,
      metadata: { sinceDate: input.sinceDate },
    });

    try {
      const [candidates, accounts, rules] = await Promise.all([
        this.transactions.listForClassification(input.userId, input.sinceDate),
        this.accounts.listContexts(input.userId),
        this.transactions.listRules(input.userId),
      ]);

      if (candidates.length === 0) {
        await this.syncRuns.finish(runId, { status: 'SUCCESS', startedAt, counts: {} });
        return { classified: 0, transfersDetected: 0, transfersNeedingReview: 0 };
      }

      const accountsById = new Map<string, AccountContext>(
        accounts.map((account) => [account.id, account]),
      );

      // ---- Classification -------------------------------------------------
      const results: { transactionId: string; result: ClassificationResult }[] = [];
      const transferCandidateIds = new Set<string>();

      for (const transaction of candidates) {
        const account = accountsById.get(transaction.accountId);
        if (!account) continue;

        const result = classifyTransaction(transaction, account, rules);
        results.push({ transactionId: transaction.id, result });
        if (result.isTransferCandidate) transferCandidateIds.add(transaction.id);
      }

      const classified = await this.transactions.applyClassifications(results);

      // ---- Transfer detection ---------------------------------------------
      const existingMatches = await this.transactions.listExistingMatches(input.userId);

      const proposed = detectTransfers({
        transactions: candidates,
        accounts,
        existingMatches,
        transferCandidateIds,
      });

      const saved = await this.transactions.saveProposedMatches(input.userId, proposed);
      const needingReview = proposed.filter((match) => match.status === 'NEEDS_REVIEW').length;

      await this.syncRuns.finish(runId, {
        status: 'SUCCESS',
        startedAt,
        counts: { processed: classified, modified: saved },
        metadata: { transfersNeedingReview: needingReview },
      });

      this.logger.info('Normalisation complete', {
        classified,
        transfersDetected: saved,
        transfersNeedingReview: needingReview,
      });

      return {
        classified,
        transfersDetected: saved,
        transfersNeedingReview: needingReview,
      };
    } catch (error) {
      await this.syncRuns.finish(runId, {
        status: 'FAILED',
        startedAt,
        errorCode: 'NORMALIZATION_FAILED',
        errorMessage: 'Transactions were imported but could not be classified.',
      });

      // Deliberately not rethrown. The transactions ARE imported; failing the
      // whole sync would hide that, and classification is retried on the next
      // run anyway. Unclassified rows surface in the review queue meanwhile.
      this.logger.error('Normalisation failed', {
        detail: error instanceof Error ? error.message : String(error),
      });

      return { classified: 0, transfersDetected: 0, transfersNeedingReview: 0 };
    }
  }
}
