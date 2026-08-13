/**
 * Supabase database types.
 *
 * This file mirrors supabase/migrations/*.sql exactly. Regenerate it from a
 * live database rather than editing it by hand:
 *
 *   pnpm db:start && pnpm db:types      # from the local stack (needs Docker)
 *   pnpm db:types:remote                # from the linked remote project
 *
 * Both commands overwrite this file. If a migration changes the schema, run one
 * of them and commit the result.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          base_currency: string;
          timezone: string;
          onboarding_completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          base_currency?: string;
          timezone?: string;
          onboarding_completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          display_name?: string | null;
          base_currency?: string;
          timezone?: string;
          onboarding_completed_at?: string | null;
        };
        Relationships: [];
      };
      institutions: {
        Row: {
          id: string;
          user_id: string;
          plaid_institution_id: string | null;
          name: string;
          display_name: string | null;
          logo_url: string | null;
          primary_color: string | null;
          website_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          plaid_institution_id?: string | null;
          name: string;
          display_name?: string | null;
          logo_url?: string | null;
          primary_color?: string | null;
          website_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          display_name?: string | null;
        };
        Relationships: [];
      };
      plaid_items: {
        Row: {
          id: string;
          user_id: string;
          institution_id: string | null;
          plaid_item_id: string;
          status: Database['public']['Enums']['plaid_item_status'];
          error_code: string | null;
          error_message: string | null;
          requires_reauth_since: string | null;
          consent_expiration_time: string | null;
          update_type: string | null;
          transaction_cursor: string | null;
          available_products: string[];
          billed_products: string[];
          last_accounts_sync_at: string | null;
          last_transactions_sync_at: string | null;
          last_successful_sync_at: string | null;
          last_webhook_at: string | null;
          disconnected_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          institution_id?: string | null;
          plaid_item_id: string;
          status?: Database['public']['Enums']['plaid_item_status'];
          error_code?: string | null;
          error_message?: string | null;
          requires_reauth_since?: string | null;
          consent_expiration_time?: string | null;
          update_type?: string | null;
          transaction_cursor?: string | null;
          available_products?: string[];
          billed_products?: string[];
          last_accounts_sync_at?: string | null;
          last_transactions_sync_at?: string | null;
          last_successful_sync_at?: string | null;
          last_webhook_at?: string | null;
          disconnected_at?: string | null;
        };
        Update: {
          institution_id?: string | null;
          status?: Database['public']['Enums']['plaid_item_status'];
          error_code?: string | null;
          error_message?: string | null;
          requires_reauth_since?: string | null;
          consent_expiration_time?: string | null;
          update_type?: string | null;
          transaction_cursor?: string | null;
          available_products?: string[];
          billed_products?: string[];
          last_accounts_sync_at?: string | null;
          last_transactions_sync_at?: string | null;
          last_successful_sync_at?: string | null;
          last_webhook_at?: string | null;
          disconnected_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'plaid_items_institution_id_fkey';
            columns: ['institution_id'];
            isOneToOne: false;
            referencedRelation: 'institutions';
            referencedColumns: ['id'];
          },
        ];
      };
      /**
       * Encrypted Plaid access tokens. Service role only — the browser client
       * can never read this table. Typed here for Edge Function use only.
       */
      plaid_item_secrets: {
        Row: {
          plaid_item_id: string;
          access_token_ciphertext: string;
          access_token_iv: string;
          key_version: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          plaid_item_id: string;
          access_token_ciphertext: string;
          access_token_iv: string;
          key_version?: number;
        };
        Update: {
          access_token_ciphertext?: string;
          access_token_iv?: string;
          key_version?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'plaid_item_secrets_plaid_item_id_fkey';
            columns: ['plaid_item_id'];
            isOneToOne: true;
            referencedRelation: 'plaid_items';
            referencedColumns: ['id'];
          },
        ];
      };
      accounts: {
        Row: {
          id: string;
          user_id: string;
          institution_id: string | null;
          plaid_item_id: string | null;
          plaid_account_id: string | null;
          source: Database['public']['Enums']['account_source'];
          name: string;
          official_name: string | null;
          mask: string | null;
          type: string;
          subtype: string | null;
          display_name: string | null;
          current_balance: number | null;
          available_balance: number | null;
          credit_limit: number | null;
          iso_currency_code: string | null;
          unofficial_currency_code: string | null;
          include_in_cash: boolean;
          include_in_net_worth: boolean;
          hidden: boolean;
          balances_updated_at: string | null;
          last_synced_at: string | null;
          closed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          institution_id?: string | null;
          plaid_item_id?: string | null;
          plaid_account_id?: string | null;
          source?: Database['public']['Enums']['account_source'];
          name: string;
          official_name?: string | null;
          mask?: string | null;
          type: string;
          subtype?: string | null;
          display_name?: string | null;
          current_balance?: number | null;
          available_balance?: number | null;
          credit_limit?: number | null;
          iso_currency_code?: string | null;
          unofficial_currency_code?: string | null;
          include_in_cash?: boolean;
          include_in_net_worth?: boolean;
          hidden?: boolean;
          balances_updated_at?: string | null;
          last_synced_at?: string | null;
          closed_at?: string | null;
        };
        Update: {
          display_name?: string | null;
          include_in_cash?: boolean;
          include_in_net_worth?: boolean;
          hidden?: boolean;
          name?: string;
          official_name?: string | null;
          type?: string;
          subtype?: string | null;
          current_balance?: number | null;
          available_balance?: number | null;
          iso_currency_code?: string | null;
          closed_at?: string | null;
          balances_updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'accounts_institution_id_fkey';
            columns: ['institution_id'];
            isOneToOne: false;
            referencedRelation: 'institutions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'accounts_plaid_item_id_fkey';
            columns: ['plaid_item_id'];
            isOneToOne: false;
            referencedRelation: 'plaid_items';
            referencedColumns: ['id'];
          },
        ];
      };
      balance_snapshots: {
        Row: {
          id: string;
          user_id: string;
          account_id: string;
          current_balance: number | null;
          available_balance: number | null;
          credit_limit: number | null;
          iso_currency_code: string | null;
          captured_at: string;
          captured_date: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          account_id: string;
          current_balance?: number | null;
          available_balance?: number | null;
          credit_limit?: number | null;
          iso_currency_code?: string | null;
          captured_at?: string;
        };
        Update: {
          current_balance?: number | null;
          available_balance?: number | null;
          credit_limit?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'balance_snapshots_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      transactions: {
        Row: {
          id: string;
          user_id: string;
          account_id: string;
          plaid_transaction_id: string | null;
          plaid_pending_transaction_id: string | null;
          posted_date: string;
          authorized_date: string | null;
          datetime: string | null;
          name: string;
          merchant_name: string | null;
          amount: number;
          iso_currency_code: string | null;
          unofficial_currency_code: string | null;
          pending: boolean;
          plaid_category_primary: string | null;
          plaid_category_detailed: string | null;
          plaid_category_confidence: string | null;
          plaid_payment_channel: string | null;
          plaid_transaction_code: string | null;
          website_url: string | null;
          logo_url: string | null;
          system_type: Database['public']['Enums']['economic_type'];
          system_transfer_subtype: Database['public']['Enums']['transfer_subtype'] | null;
          system_classification_reason: string | null;
          system_classified_at: string | null;
          user_type: Database['public']['Enums']['economic_type'] | null;
          user_transfer_subtype: Database['public']['Enums']['transfer_subtype'] | null;
          user_classified_at: string | null;
          excluded_from_spending: boolean;
          transfer_match_id: string | null;
          source_transaction_id: string | null;
          removed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          account_id: string;
          plaid_transaction_id?: string | null;
          plaid_pending_transaction_id?: string | null;
          posted_date: string;
          authorized_date?: string | null;
          datetime?: string | null;
          name: string;
          merchant_name?: string | null;
          amount: number;
          iso_currency_code?: string | null;
          unofficial_currency_code?: string | null;
          pending?: boolean;
          plaid_category_primary?: string | null;
          plaid_category_detailed?: string | null;
          plaid_category_confidence?: string | null;
          plaid_payment_channel?: string | null;
          plaid_transaction_code?: string | null;
          website_url?: string | null;
          logo_url?: string | null;
          system_type?: Database['public']['Enums']['economic_type'];
          system_transfer_subtype?: Database['public']['Enums']['transfer_subtype'] | null;
          system_classification_reason?: string | null;
          system_classified_at?: string | null;
          user_type?: Database['public']['Enums']['economic_type'] | null;
          user_transfer_subtype?: Database['public']['Enums']['transfer_subtype'] | null;
          user_classified_at?: string | null;
          excluded_from_spending?: boolean;
          transfer_match_id?: string | null;
          source_transaction_id?: string | null;
          removed_at?: string | null;
        };
        /**
         * Column-level grants mean the browser may only write these fields.
         * Edge Functions (service role) may write any column in Insert.
         */
        Update: {
          user_type?: Database['public']['Enums']['economic_type'] | null;
          user_transfer_subtype?: Database['public']['Enums']['transfer_subtype'] | null;
          user_classified_at?: string | null;
          excluded_from_spending?: boolean;
          source_transaction_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'transactions_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'transactions_transfer_match_id_fkey';
            columns: ['transfer_match_id'];
            isOneToOne: false;
            referencedRelation: 'transfer_matches';
            referencedColumns: ['id'];
          },
        ];
      };
      transfer_matches: {
        Row: {
          id: string;
          user_id: string;
          outgoing_transaction_id: string;
          incoming_transaction_id: string;
          confidence: number;
          detection_method: string;
          reason: Json;
          subtype: Database['public']['Enums']['transfer_subtype'];
          status: Database['public']['Enums']['transfer_match_status'];
          user_confirmed_at: string | null;
          user_rejected_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          outgoing_transaction_id: string;
          incoming_transaction_id: string;
          confidence: number;
          detection_method: string;
          reason?: Json;
          subtype?: Database['public']['Enums']['transfer_subtype'];
          status?: Database['public']['Enums']['transfer_match_status'];
          user_confirmed_at?: string | null;
          user_rejected_at?: string | null;
        };
        Update: {
          confidence?: number;
          detection_method?: string;
          reason?: Json;
          subtype?: Database['public']['Enums']['transfer_subtype'];
          status?: Database['public']['Enums']['transfer_match_status'];
          user_confirmed_at?: string | null;
          user_rejected_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'transfer_matches_outgoing_transaction_id_fkey';
            columns: ['outgoing_transaction_id'];
            isOneToOne: false;
            referencedRelation: 'transactions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'transfer_matches_incoming_transaction_id_fkey';
            columns: ['incoming_transaction_id'];
            isOneToOne: false;
            referencedRelation: 'transactions';
            referencedColumns: ['id'];
          },
        ];
      };
      transaction_rules: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          enabled: boolean;
          priority: number;
          match_field: Database['public']['Enums']['rule_match_field'];
          match_operator: Database['public']['Enums']['rule_match_operator'];
          match_value: string;
          min_amount: number | null;
          max_amount: number | null;
          account_id: string | null;
          result_type: Database['public']['Enums']['economic_type'];
          result_transfer_subtype: Database['public']['Enums']['transfer_subtype'] | null;
          last_applied_at: string | null;
          match_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          enabled?: boolean;
          priority?: number;
          match_field?: Database['public']['Enums']['rule_match_field'];
          match_operator?: Database['public']['Enums']['rule_match_operator'];
          match_value: string;
          min_amount?: number | null;
          max_amount?: number | null;
          account_id?: string | null;
          result_type: Database['public']['Enums']['economic_type'];
          result_transfer_subtype?: Database['public']['Enums']['transfer_subtype'] | null;
        };
        Update: {
          name?: string;
          enabled?: boolean;
          priority?: number;
          match_field?: Database['public']['Enums']['rule_match_field'];
          match_operator?: Database['public']['Enums']['rule_match_operator'];
          match_value?: string;
          min_amount?: number | null;
          max_amount?: number | null;
          account_id?: string | null;
          result_type?: Database['public']['Enums']['economic_type'];
          result_transfer_subtype?: Database['public']['Enums']['transfer_subtype'] | null;
        };
        Relationships: [
          {
            foreignKeyName: 'transaction_rules_account_id_fkey';
            columns: ['account_id'];
            isOneToOne: false;
            referencedRelation: 'accounts';
            referencedColumns: ['id'];
          },
        ];
      };
      sync_runs: {
        Row: {
          id: string;
          user_id: string | null;
          plaid_item_id: string | null;
          operation: Database['public']['Enums']['sync_operation'];
          status: Database['public']['Enums']['sync_status'];
          request_id: string | null;
          started_at: string;
          finished_at: string | null;
          duration_ms: number | null;
          records_added: number;
          records_modified: number;
          records_removed: number;
          records_processed: number;
          error_code: string | null;
          error_message: string | null;
          metadata: Json;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          plaid_item_id?: string | null;
          operation: Database['public']['Enums']['sync_operation'];
          status?: Database['public']['Enums']['sync_status'];
          request_id?: string | null;
          started_at?: string;
          finished_at?: string | null;
          duration_ms?: number | null;
          records_added?: number;
          records_modified?: number;
          records_removed?: number;
          records_processed?: number;
          error_code?: string | null;
          error_message?: string | null;
          metadata?: Json;
        };
        Update: {
          status?: Database['public']['Enums']['sync_status'];
          finished_at?: string | null;
          duration_ms?: number | null;
          records_added?: number;
          records_modified?: number;
          records_removed?: number;
          records_processed?: number;
          error_code?: string | null;
          error_message?: string | null;
          metadata?: Json;
        };
        Relationships: [
          {
            foreignKeyName: 'sync_runs_plaid_item_id_fkey';
            columns: ['plaid_item_id'];
            isOneToOne: false;
            referencedRelation: 'plaid_items';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      transactions_classified: {
        Row: {
          id: string;
          user_id: string;
          account_id: string;
          institution_id: string | null;
          account_name: string;
          account_mask: string | null;
          account_type: string;
          account_subtype: string | null;
          account_source: Database['public']['Enums']['account_source'];
          institution_name: string | null;
          posted_date: string;
          authorized_date: string | null;
          datetime: string | null;
          name: string;
          merchant_name: string | null;
          display_name: string;
          amount: number;
          pending: boolean;
          plaid_transaction_id: string | null;
          plaid_category_primary: string | null;
          plaid_category_detailed: string | null;
          plaid_category_confidence: string | null;
          plaid_payment_channel: string | null;
          logo_url: string | null;
          website_url: string | null;
          currency: string | null;
          effective_type: Database['public']['Enums']['economic_type'];
          effective_transfer_subtype: Database['public']['Enums']['transfer_subtype'] | null;
          is_user_overridden: boolean;
          system_type: Database['public']['Enums']['economic_type'];
          system_transfer_subtype: Database['public']['Enums']['transfer_subtype'] | null;
          system_classification_reason: string | null;
          user_type: Database['public']['Enums']['economic_type'] | null;
          direction: string;
          absolute_amount: number;
          excluded_from_spending: boolean;
          transfer_match_id: string | null;
          source_transaction_id: string | null;
          removed_at: string | null;
          created_at: string;
          updated_at: string;
          is_reportable: boolean;
          spending_exclusion_bucket: string | null;
          income_exclusion_bucket: string | null;
        };
        Relationships: [];
      };
      account_balances: {
        Row: {
          id: string;
          user_id: string;
          institution_id: string | null;
          plaid_item_id: string | null;
          source: Database['public']['Enums']['account_source'];
          name: string;
          display_name: string | null;
          effective_name: string;
          official_name: string | null;
          mask: string | null;
          type: string;
          subtype: string | null;
          current_balance: number | null;
          available_balance: number | null;
          credit_limit: number | null;
          currency: string | null;
          include_in_cash: boolean;
          include_in_net_worth: boolean;
          hidden: boolean;
          balances_updated_at: string | null;
          last_synced_at: string | null;
          closed_at: string | null;
          institution_name: string | null;
          institution_display_name: string | null;
          institution_effective_name: string | null;
          institution_logo_url: string | null;
          institution_primary_color: string | null;
          item_status: Database['public']['Enums']['plaid_item_status'] | null;
          item_error_code: string | null;
          requires_reauth_since: string | null;
          last_successful_sync_at: string | null;
          cash_bucket: string;
        };
        Relationships: [];
      };
      transfer_review_queue: {
        Row: {
          id: string;
          user_id: string;
          confidence: number;
          detection_method: string;
          reason: Json;
          subtype: Database['public']['Enums']['transfer_subtype'];
          status: Database['public']['Enums']['transfer_match_status'];
          created_at: string;
          outgoing_transaction_id: string;
          outgoing_date: string;
          outgoing_name: string;
          outgoing_amount: number;
          outgoing_currency: string | null;
          outgoing_account_name: string;
          outgoing_institution_name: string | null;
          incoming_transaction_id: string;
          incoming_date: string;
          incoming_name: string;
          incoming_amount: number;
          incoming_currency: string | null;
          incoming_account_name: string;
          incoming_institution_name: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      current_base_currency: {
        Args: Record<string, never>;
        Returns: string;
      };
      dashboard_cash_summary: {
        Args: Record<string, never>;
        Returns: {
          currency: string;
          total_cash: number;
          checking_total: number;
          savings_total: number;
          other_cash_total: number;
          credit_owed_total: number;
          cash_account_count: number;
          checking_account_count: number;
          savings_account_count: number;
          credit_account_count: number;
          institution_count: number;
          excluded_account_count: number;
          excluded_currencies: string[];
          last_accounts_sync_at: string | null;
        }[];
      };
      monthly_cashflow: {
        Args: { p_from: string; p_to: string };
        Returns: {
          month_start: string;
          currency: string;
          gross_debits: number;
          gross_credits: number;
          expense_outflows: number;
          refunds: number;
          actual_spending: number;
          actual_income: number;
          internal_transfers: number;
          credit_card_payments: number;
          investment_transfers: number;
          unclassified_outflows: number;
          adjustment_outflows: number;
          user_excluded_outflows: number;
          other_non_expense_outflows: number;
          income_internal_transfers: number;
          income_unclassified: number;
          surplus: number;
          savings_rate: number | null;
          transaction_count: number;
          unclassified_transaction_count: number;
          foreign_currency_transaction_count: number;
        }[];
      };
      spending_by_category: {
        Args: { p_from: string; p_to: string };
        Returns: {
          category: string;
          amount: number;
          transaction_count: number;
          refund_amount: number;
          share: number | null;
        }[];
      };
      income_by_source: {
        Args: { p_from: string; p_to: string };
        Returns: {
          source: string;
          category: string;
          amount: number;
          transaction_count: number;
          share: number | null;
        }[];
      };
      top_merchants: {
        Args: { p_from: string; p_to: string; p_limit?: number };
        Returns: {
          merchant: string;
          amount: number;
          transaction_count: number;
          refund_amount: number;
          logo_url: string | null;
          last_transaction_date: string | null;
        }[];
      };
      transfer_summary: {
        Args: { p_from: string; p_to: string };
        Returns: {
          bucket: string;
          amount: number;
          transaction_count: number;
        }[];
      };
      data_freshness: {
        Args: Record<string, never>;
        Returns: {
          institution_id: string;
          institution_name: string;
          plaid_item_id: string;
          item_status: Database['public']['Enums']['plaid_item_status'];
          error_code: string | null;
          requires_reauth: boolean;
          account_count: number;
          last_accounts_sync_at: string | null;
          last_transactions_sync_at: string | null;
          last_successful_sync_at: string | null;
        }[];
      };
      cash_trend: {
        Args: { p_from: string; p_to: string };
        Returns: {
          month_start: string;
          total_cash: number;
          currency: string;
          accounts_with_data: number;
          accounts_expected: number;
          is_complete: boolean;
        }[];
      };
      confirm_transfer_match: {
        Args: { p_match_id: string };
        Returns: Database['public']['Tables']['transfer_matches']['Row'];
      };
      reject_transfer_match: {
        Args: { p_match_id: string };
        Returns: Database['public']['Tables']['transfer_matches']['Row'];
      };
      create_manual_transfer_match: {
        Args: {
          p_outgoing_transaction_id: string;
          p_incoming_transaction_id: string;
          p_subtype?: Database['public']['Enums']['transfer_subtype'];
        };
        Returns: Database['public']['Tables']['transfer_matches']['Row'];
      };
      find_transfer_candidates: {
        Args: { p_transaction_id: string; p_day_window?: number; p_limit?: number };
        Returns: {
          id: string;
          posted_date: string;
          display_name: string;
          absolute_amount: number;
          currency: string | null;
          account_name: string;
          institution_name: string | null;
          amount_delta: number;
          day_delta: number;
        }[];
      };
    };
    Enums: {
      account_source: 'plaid' | 'manual';
      economic_type: 'INCOME' | 'EXPENSE' | 'REFUND' | 'TRANSFER' | 'ADJUSTMENT' | 'UNKNOWN';
      transfer_subtype:
        | 'ACCOUNT_TO_ACCOUNT'
        | 'CHECKING_TO_SAVINGS'
        | 'SAVINGS_TO_CHECKING'
        | 'CREDIT_CARD_PAYMENT'
        | 'INVESTMENT_TRANSFER'
        | 'OTHER_INTERNAL';
      transfer_match_status: 'AUTO_MATCHED' | 'NEEDS_REVIEW' | 'USER_CONFIRMED' | 'USER_REJECTED';
      plaid_item_status:
        | 'ACTIVE'
        | 'LOGIN_REQUIRED'
        | 'PENDING_EXPIRATION'
        | 'ERROR'
        | 'REVOKED'
        | 'DISCONNECTED';
      sync_operation:
        | 'ITEM_EXCHANGE'
        | 'ACCOUNTS_SYNC'
        | 'TRANSACTIONS_SYNC'
        | 'ITEM_REMOVE'
        | 'WEBHOOK'
        | 'SYNC_ALL'
        | 'TRANSFER_DETECTION';
      sync_status: 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED';
      rule_match_field:
        | 'MERCHANT_NAME'
        | 'RAW_NAME'
        | 'MERCHANT_OR_NAME'
        | 'PLAID_CATEGORY_PRIMARY'
        | 'PLAID_CATEGORY_DETAILED';
      rule_match_operator: 'CONTAINS' | 'EQUALS' | 'STARTS_WITH' | 'ENDS_WITH';
    };
    CompositeTypes: Record<string, never>;
  };
};

// ---------------------------------------------------------------------------
// Convenience helpers (mirrors what `supabase gen types` emits).
// ---------------------------------------------------------------------------

type PublicSchema = Database['public'];

export type Tables<T extends keyof (PublicSchema['Tables'] & PublicSchema['Views'])> =
  (PublicSchema['Tables'] & PublicSchema['Views'])[T] extends { Row: infer R } ? R : never;

export type TablesInsert<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T] extends { Insert: infer I } ? I : never;

export type TablesUpdate<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T] extends { Update: infer U } ? U : never;

export type Enums<T extends keyof PublicSchema['Enums']> = PublicSchema['Enums'][T];

export type FunctionArgs<T extends keyof PublicSchema['Functions']> =
  PublicSchema['Functions'][T]['Args'];

export type FunctionReturns<T extends keyof PublicSchema['Functions']> =
  PublicSchema['Functions'][T]['Returns'];
