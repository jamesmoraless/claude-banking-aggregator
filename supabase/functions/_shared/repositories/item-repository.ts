import type { SupabaseClient } from '@supabase/supabase-js';

import { decryptAccessToken, encryptAccessToken } from '../crypto/token-cipher.ts';
import { AppError } from '../errors/app-error.ts';

/**
 * Plaid Item persistence, including the access token.
 *
 * This is the only module that touches `plaid_item_secrets`. The decrypted
 * token is returned to services that need it for a Plaid call and is never
 * stored on a returned object that could be logged or serialised.
 */

export type PlaidItemRecord = {
  id: string;
  userId: string;
  institutionId: string | null;
  plaidItemId: string;
  status: string;
  transactionCursor: string | null;
  disconnectedAt: string | null;
};

export type ItemWithToken = PlaidItemRecord & { accessToken: string };

const ITEM_COLUMNS =
  'id, user_id, institution_id, plaid_item_id, status, transaction_cursor, disconnected_at';

type ItemRow = {
  id: string;
  user_id: string;
  institution_id: string | null;
  plaid_item_id: string;
  status: string;
  transaction_cursor: string | null;
  disconnected_at: string | null;
};

function toRecord(row: ItemRow): PlaidItemRecord {
  return {
    id: row.id,
    userId: row.user_id,
    institutionId: row.institution_id,
    plaidItemId: row.plaid_item_id,
    status: row.status,
    transactionCursor: row.transaction_cursor,
    disconnectedAt: row.disconnected_at,
  };
}

export class ItemRepository {
  constructor(private readonly client: SupabaseClient) {}

  async findById(userId: string, itemId: string): Promise<PlaidItemRecord | null> {
    const { data, error } = await this.client
      .from('plaid_items')
      .select(ITEM_COLUMNS)
      .eq('id', itemId)
      // Ownership is enforced here because the admin client bypasses RLS.
      .eq('user_id', userId)
      .maybeSingle();

    if (error) throw AppError.database('findItemById', error.message);
    return data ? toRecord(data as ItemRow) : null;
  }

  async findByPlaidItemId(plaidItemId: string): Promise<PlaidItemRecord | null> {
    const { data, error } = await this.client
      .from('plaid_items')
      .select(ITEM_COLUMNS)
      .eq('plaid_item_id', plaidItemId)
      .maybeSingle();

    if (error) throw AppError.database('findItemByPlaidItemId', error.message);
    return data ? toRecord(data as ItemRow) : null;
  }

  async listActive(userId: string): Promise<PlaidItemRecord[]> {
    const { data, error } = await this.client
      .from('plaid_items')
      .select(ITEM_COLUMNS)
      .eq('user_id', userId)
      .is('disconnected_at', null)
      .order('created_at');

    if (error) throw AppError.database('listActiveItems', error.message);
    return (data as ItemRow[]).map(toRecord);
  }

  /** Every active Item across all users. Scheduled sync only. */
  async listAllActive(): Promise<PlaidItemRecord[]> {
    const { data, error } = await this.client
      .from('plaid_items')
      .select(ITEM_COLUMNS)
      .is('disconnected_at', null)
      .neq('status', 'REVOKED')
      .order('last_transactions_sync_at', { ascending: true, nullsFirst: true });

    if (error) throw AppError.database('listAllActiveItems', error.message);
    return (data as ItemRow[]).map(toRecord);
  }

  /**
   * Loads an Item together with its decrypted access token.
   *
   * Kept separate from `findById` so that reading an Item for display never
   * incidentally decrypts a credential.
   */
  async loadWithToken(itemId: string): Promise<ItemWithToken> {
    const { data, error } = await this.client
      .from('plaid_items')
      .select(`${ITEM_COLUMNS}, plaid_item_secrets ( access_token_ciphertext, access_token_iv, key_version )`)
      .eq('id', itemId)
      .maybeSingle();

    if (error) throw AppError.database('loadItemWithToken', error.message);
    if (!data) throw AppError.notFound('That connection no longer exists.');

    const row = data as ItemRow & {
      plaid_item_secrets:
        | { access_token_ciphertext: string; access_token_iv: string; key_version: number }
        | { access_token_ciphertext: string; access_token_iv: string; key_version: number }[]
        | null;
    };

    const secret = Array.isArray(row.plaid_item_secrets)
      ? row.plaid_item_secrets[0]
      : row.plaid_item_secrets;

    if (!secret) {
      throw new AppError(
        'PLAID_ITEM_LOGIN_REQUIRED',
        'This connection is missing its credentials. Please reconnect the institution.',
      );
    }

    const accessToken = await decryptAccessToken({
      ciphertext: secret.access_token_ciphertext,
      iv: secret.access_token_iv,
      keyVersion: secret.key_version,
    });

    return { ...toRecord(row), accessToken };
  }

  async create(input: {
    userId: string;
    institutionId: string | null;
    plaidItemId: string;
    accessToken: string;
    availableProducts: string[];
    billedProducts: string[];
  }): Promise<PlaidItemRecord> {
    const { data, error } = await this.client
      .from('plaid_items')
      .insert({
        user_id: input.userId,
        institution_id: input.institutionId,
        plaid_item_id: input.plaidItemId,
        status: 'ACTIVE',
        available_products: input.availableProducts,
        billed_products: input.billedProducts,
      })
      .select(ITEM_COLUMNS)
      .single();

    if (error) throw AppError.database('createItem', error.message);

    const item = toRecord(data as ItemRow);
    await this.storeAccessToken(item.id, input.accessToken);
    return item;
  }

  async storeAccessToken(itemId: string, accessToken: string): Promise<void> {
    const encrypted = await encryptAccessToken(accessToken);

    const { error } = await this.client.from('plaid_item_secrets').upsert(
      {
        plaid_item_id: itemId,
        access_token_ciphertext: encrypted.ciphertext,
        access_token_iv: encrypted.iv,
        key_version: encrypted.keyVersion,
      },
      { onConflict: 'plaid_item_id' },
    );

    if (error) throw AppError.database('storeAccessToken', error.message);
  }

  /**
   * Persists the sync cursor.
   *
   * Called only after the page it belongs to has been committed. Advancing it
   * earlier would skip transactions permanently on a mid-sync failure.
   */
  async saveCursor(itemId: string, cursor: string): Promise<void> {
    const { error } = await this.client
      .from('plaid_items')
      .update({ transaction_cursor: cursor })
      .eq('id', itemId);

    if (error) throw AppError.database('saveCursor', error.message);
  }

  async markSynced(
    itemId: string,
    kind: 'accounts' | 'transactions',
    at = new Date().toISOString(),
  ): Promise<void> {
    const { error } = await this.client
      .from('plaid_items')
      .update({
        ...(kind === 'accounts'
          ? { last_accounts_sync_at: at }
          : { last_transactions_sync_at: at }),
        last_successful_sync_at: at,
        status: 'ACTIVE',
        error_code: null,
        error_message: null,
        requires_reauth_since: null,
      })
      .eq('id', itemId);

    if (error) throw AppError.database('markSynced', error.message);
  }

  async markError(
    itemId: string,
    input: { status: string; errorCode: string | null; errorMessage: string | null },
  ): Promise<void> {
    const requiresReauth = input.status === 'LOGIN_REQUIRED' || input.status === 'REVOKED';

    const { error } = await this.client
      .from('plaid_items')
      .update({
        status: input.status,
        error_code: input.errorCode,
        // Only our own safe message is stored; Plaid's developer-facing text
        // is not persisted, because sync_runs and plaid_items are user-readable.
        error_message: input.errorMessage,
        ...(requiresReauth ? { requires_reauth_since: new Date().toISOString() } : {}),
      })
      .eq('id', itemId);

    if (error) throw AppError.database('markItemError', error.message);
  }

  async markWebhookReceived(itemId: string): Promise<void> {
    await this.client
      .from('plaid_items')
      .update({ last_webhook_at: new Date().toISOString() })
      .eq('id', itemId);
  }

  /**
   * Disconnects an Item.
   *
   * Accounts and transactions are deliberately retained: they are the user's
   * financial history, and deleting years of it because a connection ended
   * would be destructive and irreversible. Only the credential is destroyed.
   */
  async disconnect(itemId: string): Promise<void> {
    const { error } = await this.client
      .from('plaid_items')
      .update({
        status: 'DISCONNECTED',
        disconnected_at: new Date().toISOString(),
        transaction_cursor: null,
      })
      .eq('id', itemId);

    if (error) throw AppError.database('disconnectItem', error.message);

    const { error: secretError } = await this.client
      .from('plaid_item_secrets')
      .delete()
      .eq('plaid_item_id', itemId);

    if (secretError) throw AppError.database('deleteAccessToken', secretError.message);
  }
}
