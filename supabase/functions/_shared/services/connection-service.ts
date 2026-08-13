import type { SupabaseClient } from '@supabase/supabase-js';

import { AppError } from '../errors/app-error.ts';
import type { Logger } from '../logging/logger.ts';
import { PlaidApiError, PlaidClient } from '../plaid/client.ts';
import { InstitutionRepository } from '../repositories/institution-repository.ts';
import { ItemRepository, type PlaidItemRecord } from '../repositories/item-repository.ts';
import { SyncRunRepository } from '../repositories/sync-run-repository.ts';

import { AccountSyncService } from './account-sync-service.ts';
import { TransactionSyncService } from './transaction-sync-service.ts';

/**
 * Connection lifecycle: linking, refreshing, disconnecting.
 */
export class ConnectionService {
  private readonly items: ItemRepository;
  private readonly institutions: InstitutionRepository;
  private readonly syncRuns: SyncRunRepository;
  private readonly accountSync: AccountSyncService;
  private readonly transactionSync: TransactionSyncService;

  constructor(
    private readonly client: SupabaseClient,
    private readonly plaid: PlaidClient,
    private readonly logger: Logger,
  ) {
    this.items = new ItemRepository(client);
    this.institutions = new InstitutionRepository(client);
    this.syncRuns = new SyncRunRepository(client, logger);
    this.accountSync = new AccountSyncService(client, plaid, logger);
    this.transactionSync = new TransactionSyncService(client, plaid, logger);
  }

  // -------------------------------------------------------------------------
  // Link
  // -------------------------------------------------------------------------

  async createLinkToken(userId: string): Promise<{ linkToken: string; expiration: string; requestId: string }> {
    const response = await this.plaid.createLinkToken(userId);
    // Only the token and its expiry leave this function. Plaid's response
    // carries nothing else we need, and nothing else should be exposed.
    return {
      linkToken: response.link_token,
      expiration: response.expiration,
      requestId: response.request_id,
    };
  }

  async createUpdateLinkToken(
    userId: string,
    itemId: string,
  ): Promise<{ linkToken: string; expiration: string; requestId: string }> {
    const item = await this.items.findById(userId, itemId);
    if (!item) throw AppError.notFound('That connection could not be found.');

    const { accessToken } = await this.items.loadWithToken(item.id);
    const response = await this.plaid.createUpdateLinkToken(userId, accessToken);

    return {
      linkToken: response.link_token,
      expiration: response.expiration,
      requestId: response.request_id,
    };
  }

  /**
   * Completes Plaid Link.
   *
   * Exchanges the public token, stores the Item with its encrypted access
   * token, then synchronises accounts and starts transaction sync so the user
   * sees real data immediately rather than an empty screen that fills in later.
   */
  async exchangePublicToken(input: {
    userId: string;
    publicToken: string;
    institutionId: string | null;
    institutionName: string | null;
    requestId: string;
  }): Promise<{
    institutionName: string;
    plaidItemId: string;
    accountsAdded: number;
    transactionsAdded: number;
    wasExistingItem: boolean;
  }> {
    const startedAt = Date.now();
    const runId = await this.syncRuns.start({
      userId: input.userId,
      itemId: null,
      operation: 'ITEM_EXCHANGE',
      requestId: input.requestId,
    });

    try {
      const exchange = await this.plaid.exchangePublicToken(input.publicToken);

      // Re-linking an institution the user already has must not create a second
      // Item. Plaid returns the same item_id, so this is the reliable check —
      // matching on institution name would not be.
      const existing = await this.items.findByPlaidItemId(exchange.item_id);
      let item: PlaidItemRecord;
      let wasExistingItem = false;

      if (existing) {
        if (existing.userId !== input.userId) {
          // The same Plaid Item cannot belong to two Cash Atlas users.
          throw new AppError(
            'PLAID_ITEM_ALREADY_LINKED',
            'This institution is already connected to a different account.',
          );
        }

        wasExistingItem = true;
        await this.items.storeAccessToken(existing.id, exchange.access_token);
        await this.client
          .from('plaid_items')
          .update({
            status: 'ACTIVE',
            error_code: null,
            error_message: null,
            requires_reauth_since: null,
            disconnected_at: null,
          })
          .eq('id', existing.id);

        item = existing;
      } else {
        const itemDetails = await this.plaid.getItem(exchange.access_token);

        const institutionId = await this.institutions.findOrCreate({
          userId: input.userId,
          plaidInstitutionId: itemDetails.item.institution_id ?? input.institutionId,
          name: input.institutionName ?? 'Connected institution',
        });

        item = await this.items.create({
          userId: input.userId,
          institutionId,
          plaidItemId: exchange.item_id,
          accessToken: exchange.access_token,
          availableProducts: itemDetails.item.available_products,
          billedProducts: itemDetails.item.billed_products,
        });
      }

      // Accounts first: transactions reference them.
      const accountResult = await this.accountSync.syncItem({
        userId: input.userId,
        item,
        requestId: input.requestId,
        accessToken: exchange.access_token,
      });

      // Plaid prepares transaction history asynchronously for a new Item, so
      // the first sync often returns little. The SYNC_UPDATES_AVAILABLE webhook
      // brings the rest; this is not treated as a failure.
      let transactionsAdded = 0;
      try {
        const transactionResult = await this.transactionSync.syncItem({
          userId: input.userId,
          item: { ...item, transactionCursor: null },
          requestId: input.requestId,
          accessToken: exchange.access_token,
        });
        transactionsAdded = transactionResult.added;
      } catch (error) {
        this.logger.warn('Initial transaction sync incomplete; awaiting webhook', {
          detail: error instanceof Error ? error.message : String(error),
        });
      }

      await this.syncRuns.finish(runId, {
        status: 'SUCCESS',
        startedAt,
        counts: { added: accountResult.accountsInserted + transactionsAdded },
        metadata: { wasExistingItem },
      });

      return {
        institutionName: accountResult.institutionName,
        plaidItemId: item.id,
        accountsAdded: accountResult.accountsInserted,
        transactionsAdded,
        wasExistingItem,
      };
    } catch (error) {
      const appError = error instanceof AppError ? error : null;
      await this.syncRuns.finish(runId, {
        status: 'FAILED',
        startedAt,
        errorCode: appError?.code ?? 'INTERNAL_ERROR',
        errorMessage: appError?.message ?? 'Could not complete the connection.',
      });
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Refresh
  // -------------------------------------------------------------------------

  /**
   * Refreshes one or all Items.
   *
   * Each Item is handled independently: one institution failing must not hide
   * the ones that succeeded. The response reports per-Item outcomes so the UI
   * can say "TD synced, RBC needs reconnecting" rather than showing one error.
   */
  async refresh(input: {
    userId: string;
    itemId?: string | null;
    requestId: string;
  }): Promise<{
    results: ItemSyncOutcome[];
    overallStatus: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  }> {
    const items = input.itemId
      ? await this.singleItem(input.userId, input.itemId)
      : await this.items.listActive(input.userId);

    if (items.length === 0) {
      return { results: [], overallStatus: 'SUCCESS' };
    }

    const results: ItemSyncOutcome[] = [];

    for (const item of items) {
      const institutionName = await this.institutions.getName(item.institutionId);

      try {
        const { accessToken } = await this.items.loadWithToken(item.id);

        const accountResult = await this.accountSync.syncItem({
          userId: input.userId,
          item,
          requestId: input.requestId,
          accessToken,
        });

        const transactionResult = await this.transactionSync.syncItem({
          userId: input.userId,
          item,
          requestId: input.requestId,
          accessToken,
        });

        results.push({
          plaidItemId: item.id,
          institutionName,
          status: 'SUCCESS',
          accountsUpdated: accountResult.accountsInserted + accountResult.accountsUpdated,
          transactionsAdded: transactionResult.added,
          transactionsModified: transactionResult.modified,
          transactionsRemoved: transactionResult.removed,
          errorCode: null,
          errorMessage: null,
        });
      } catch (error) {
        const appError = error instanceof AppError ? error : null;

        this.logger.warn('Item refresh failed', {
          itemId: item.id,
          code: appError?.code ?? 'INTERNAL_ERROR',
        });

        results.push({
          plaidItemId: item.id,
          institutionName,
          status: 'FAILED',
          accountsUpdated: 0,
          transactionsAdded: 0,
          transactionsModified: 0,
          transactionsRemoved: 0,
          errorCode: appError?.code ?? 'INTERNAL_ERROR',
          errorMessage: appError?.message ?? 'This institution could not be synchronised.',
        });
      }
    }

    const succeeded = results.filter((result) => result.status === 'SUCCESS').length;

    return {
      results,
      overallStatus:
        succeeded === results.length ? 'SUCCESS' : succeeded === 0 ? 'FAILED' : 'PARTIAL',
    };
  }

  private async singleItem(userId: string, itemId: string): Promise<PlaidItemRecord[]> {
    const item = await this.items.findById(userId, itemId);
    if (!item) throw AppError.notFound('That connection could not be found.');
    return [item];
  }

  // -------------------------------------------------------------------------
  // Remove
  // -------------------------------------------------------------------------

  /**
   * Disconnects an institution.
   *
   * Tells Plaid to release the Item, then destroys the stored credential.
   * Accounts and transactions are KEPT: they are the user's financial history,
   * and a disconnect is not a request to erase years of records.
   */
  async removeItem(input: {
    userId: string;
    itemId: string;
    requestId: string;
  }): Promise<{ plaidItemId: string; historyRetained: true }> {
    const startedAt = Date.now();
    const item = await this.items.findById(input.userId, input.itemId);
    if (!item) throw AppError.notFound('That connection could not be found.');

    const runId = await this.syncRuns.start({
      userId: input.userId,
      itemId: item.id,
      operation: 'ITEM_REMOVE',
      requestId: input.requestId,
    });

    try {
      const { accessToken } = await this.items.loadWithToken(item.id);
      await this.plaid.removeItem(accessToken);
    } catch (error) {
      // If Plaid already considers the Item gone, local cleanup should still
      // proceed — otherwise the user is stuck with a connection they cannot
      // remove.
      const alreadyGone =
        error instanceof PlaidApiError &&
        (error.plaidErrorCode === 'ITEM_NOT_FOUND' || error.requiresReauth);

      if (!alreadyGone) {
        this.logger.warn('Plaid item removal failed; disconnecting locally anyway', {
          itemId: item.id,
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await this.items.disconnect(item.id);

    await this.syncRuns.finish(runId, { status: 'SUCCESS', startedAt, counts: {} });

    this.logger.info('Institution disconnected', { itemId: item.id });

    return { plaidItemId: item.id, historyRetained: true };
  }
}

export type ItemSyncOutcome = {
  plaidItemId: string;
  institutionName: string;
  status: 'SUCCESS' | 'FAILED';
  accountsUpdated: number;
  transactionsAdded: number;
  transactionsModified: number;
  transactionsRemoved: number;
  errorCode: string | null;
  errorMessage: string | null;
};
