import type { SupabaseClient } from '@supabase/supabase-js';

import { AppError } from '../errors/app-error.ts';
import type { Logger } from '../logging/logger.ts';
import { PlaidApiError, PlaidClient } from '../plaid/client.ts';
import { AccountRepository } from '../repositories/account-repository.ts';
import { InstitutionRepository } from '../repositories/institution-repository.ts';
import { ItemRepository, type PlaidItemRecord } from '../repositories/item-repository.ts';
import { SyncRunRepository } from '../repositories/sync-run-repository.ts';

/**
 * Account and balance synchronisation.
 *
 * Fetches current accounts and balances for an Item, upserts them preserving
 * every user-configurable field, records a daily balance snapshot, and updates
 * the Item's health.
 */

export type AccountSyncResult = {
  itemId: string;
  institutionName: string;
  accountsInserted: number;
  accountsUpdated: number;
  snapshotsRecorded: number;
};

export class AccountSyncService {
  private readonly accounts: AccountRepository;
  private readonly institutions: InstitutionRepository;
  private readonly items: ItemRepository;
  private readonly syncRuns: SyncRunRepository;

  constructor(
    private readonly client: SupabaseClient,
    private readonly plaid: PlaidClient,
    private readonly logger: Logger,
  ) {
    this.accounts = new AccountRepository(client);
    this.institutions = new InstitutionRepository(client);
    this.items = new ItemRepository(client);
    this.syncRuns = new SyncRunRepository(client, logger);
  }

  async syncItem(input: {
    userId: string;
    item: PlaidItemRecord;
    requestId: string;
    accessToken?: string;
  }): Promise<AccountSyncResult> {
    const startedAt = Date.now();
    const runId = await this.syncRuns.start({
      userId: input.userId,
      itemId: input.item.id,
      operation: 'ACCOUNTS_SYNC',
      requestId: input.requestId,
    });

    try {
      const accessToken =
        input.accessToken ?? (await this.items.loadWithToken(input.item.id)).accessToken;

      const response = await this.plaid.getAccounts(accessToken);

      // Plaid can report an Item-level error alongside a successful response.
      if (response.item.error) {
        this.logger.warn('Plaid reported an item error during account sync', {
          errorCode: response.item.error.error_code,
        });
      }

      const institutionId = await this.resolveInstitution(input.userId, response.item.institution_id);

      const upserted = await this.accounts.upsertFromPlaid({
        userId: input.userId,
        itemId: input.item.id,
        institutionId,
        accounts: response.accounts,
      });

      const snapshotsRecorded = await this.accounts.recordSnapshots({
        userId: input.userId,
        accounts: response.accounts.map((plaidAccount, index) => ({
          accountId: upserted.accountIds[index]!,
          plaidAccount,
        })),
      });

      if (institutionId && !input.item.institutionId) {
        await this.client
          .from('plaid_items')
          .update({ institution_id: institutionId })
          .eq('id', input.item.id);
      }

      await this.items.markSynced(input.item.id, 'accounts');

      const institutionName = await this.institutions.getName(institutionId);

      await this.syncRuns.finish(runId, {
        status: 'SUCCESS',
        startedAt,
        counts: {
          added: upserted.inserted,
          modified: upserted.updated,
          processed: response.accounts.length,
        },
      });

      this.logger.info('Accounts synchronised', {
        itemId: input.item.id,
        inserted: upserted.inserted,
        updated: upserted.updated,
      });

      return {
        itemId: input.item.id,
        institutionName,
        accountsInserted: upserted.inserted,
        accountsUpdated: upserted.updated,
        snapshotsRecorded,
      };
    } catch (error) {
      await this.recordFailure(runId, startedAt, input.item.id, error);
      throw error;
    }
  }

  private async resolveInstitution(
    userId: string,
    plaidInstitutionId: string | null,
  ): Promise<string | null> {
    if (!plaidInstitutionId) return null;

    try {
      const { institution } = await this.plaid.getInstitution(plaidInstitutionId);
      return await this.institutions.findOrCreate({
        userId,
        plaidInstitutionId,
        name: institution.name,
        institution,
      });
    } catch (error) {
      // Institution metadata is cosmetic. Failing the whole account sync
      // because a logo could not be fetched would be disproportionate.
      this.logger.warn('Could not load institution metadata', {
        detail: error instanceof Error ? error.message : String(error),
      });
      return await this.institutions.findOrCreate({
        userId,
        plaidInstitutionId,
        name: 'Connected institution',
      });
    }
  }

  private async recordFailure(
    runId: string | null,
    startedAt: number,
    itemId: string,
    error: unknown,
  ): Promise<void> {
    const appError = error instanceof AppError ? error : null;

    if (error instanceof PlaidApiError && error.requiresReauth) {
      await this.items.markError(itemId, {
        status: 'LOGIN_REQUIRED',
        errorCode: error.plaidErrorCode,
        errorMessage: error.message,
      });
    } else if (appError) {
      await this.items.markError(itemId, {
        status: 'ERROR',
        errorCode: appError.code,
        errorMessage: appError.message,
      });
    }

    await this.syncRuns.finish(runId, {
      status: 'FAILED',
      startedAt,
      errorCode: appError?.code ?? 'INTERNAL_ERROR',
      errorMessage: appError?.message ?? 'Account sync failed.',
    });
  }
}
