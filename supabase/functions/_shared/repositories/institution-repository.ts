import type { SupabaseClient } from '@supabase/supabase-js';

import { AppError } from '../errors/app-error.ts';
import type { PlaidInstitution } from '../plaid/types.ts';

/**
 * Institution persistence.
 *
 * `display_name` is the user's label and is written only by the user. Sync
 * refreshes the bank's own name and branding around it.
 */
export class InstitutionRepository {
  constructor(private readonly client: SupabaseClient) {}

  async findOrCreate(input: {
    userId: string;
    plaidInstitutionId: string | null;
    name: string;
    institution?: PlaidInstitution | null;
  }): Promise<string> {
    if (input.plaidInstitutionId) {
      const { data: existing, error: findError } = await this.client
        .from('institutions')
        .select('id')
        .eq('user_id', input.userId)
        .eq('plaid_institution_id', input.plaidInstitutionId)
        .maybeSingle();

      if (findError) throw AppError.database('findInstitution', findError.message);

      if (existing) {
        const id = (existing as { id: string }).id;
        // Refresh bank-owned metadata; display_name is untouched.
        await this.client
          .from('institutions')
          .update({
            name: input.name,
            logo_url: logoDataUrl(input.institution),
            primary_color: input.institution?.primary_color ?? null,
            website_url: input.institution?.url ?? null,
          })
          .eq('id', id);
        return id;
      }
    }

    const { data, error } = await this.client
      .from('institutions')
      .insert({
        user_id: input.userId,
        plaid_institution_id: input.plaidInstitutionId,
        name: input.name,
        logo_url: logoDataUrl(input.institution),
        primary_color: input.institution?.primary_color ?? null,
        website_url: input.institution?.url ?? null,
      })
      .select('id')
      .single();

    if (error) throw AppError.database('createInstitution', error.message);
    return (data as { id: string }).id;
  }

  async getName(institutionId: string | null): Promise<string> {
    if (!institutionId) return 'Unknown institution';

    const { data } = await this.client
      .from('institutions')
      .select('name, display_name')
      .eq('id', institutionId)
      .maybeSingle();

    const row = data as { name: string; display_name: string | null } | null;
    return row?.display_name ?? row?.name ?? 'Unknown institution';
  }
}

/** Plaid returns logos as bare base64 PNG; store a usable data URL. */
function logoDataUrl(institution: PlaidInstitution | null | undefined): string | null {
  return institution?.logo ? `data:image/png;base64,${institution.logo}` : null;
}
