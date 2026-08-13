-- ---------------------------------------------------------------------------
-- Cash Atlas — transfer review actions
--
-- Confirming or rejecting a match has to touch three rows atomically (the match
-- and both legs), so it is exposed as an RPC rather than as table grants. Each
-- function is SECURITY DEFINER and re-derives the caller from auth.uid(): a
-- user_id is never accepted as an argument.
-- ---------------------------------------------------------------------------

create or replace function public.confirm_transfer_match(p_match_id uuid)
returns public.transfer_matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_match public.transfer_matches;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select * into v_match
  from public.transfer_matches m
  where m.id = p_match_id and m.user_id = v_user_id
  for update;

  if not found then
    raise exception 'TRANSFER_MATCH_NOT_FOUND' using errcode = 'P0002';
  end if;

  update public.transfer_matches
  set status = 'USER_CONFIRMED',
      user_confirmed_at = now(),
      user_rejected_at = null
  where id = p_match_id
  returning * into v_match;

  -- Confirming is an explicit user decision, so it is recorded as a user
  -- override on both legs. That gives it precedence over any future automatic
  -- re-classification.
  update public.transactions
  set user_type = 'TRANSFER',
      user_transfer_subtype = v_match.subtype,
      user_classified_at = now(),
      transfer_match_id = v_match.id
  where user_id = v_user_id
    and id in (v_match.outgoing_transaction_id, v_match.incoming_transaction_id);

  return v_match;
end;
$$;

comment on function public.confirm_transfer_match is
  'Confirms a transfer pair and records TRANSFER as a user override on both legs.';

create or replace function public.reject_transfer_match(p_match_id uuid)
returns public.transfer_matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_match public.transfer_matches;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select * into v_match
  from public.transfer_matches m
  where m.id = p_match_id and m.user_id = v_user_id
  for update;

  if not found then
    raise exception 'TRANSFER_MATCH_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- The rejected row is KEPT. Detection reads it and will not re-propose the
  -- same pair, which is what makes repeated detection runs idempotent.
  update public.transfer_matches
  set status = 'USER_REJECTED',
      user_rejected_at = now(),
      user_confirmed_at = null
  where id = p_match_id
  returning * into v_match;

  -- Both legs return to "needs review" rather than being guessed at. We know
  -- the transfer hypothesis was wrong; we do not yet know what is right, and
  -- inventing a classification here would silently move money between the
  -- income and spending totals.
  update public.transactions
  set transfer_match_id = null,
      system_type = 'UNKNOWN',
      system_transfer_subtype = null,
      system_classification_reason = 'transfer_match_rejected_by_user',
      system_classified_at = now(),
      user_type = null,
      user_transfer_subtype = null,
      user_classified_at = null
  where user_id = v_user_id
    and id in (v_match.outgoing_transaction_id, v_match.incoming_transaction_id)
    and transfer_match_id = v_match.id;

  return v_match;
end;
$$;

comment on function public.reject_transfer_match is
  'Rejects a transfer pair, retains the rejection so detection will not re-propose it, and returns both legs to the review queue.';

create or replace function public.create_manual_transfer_match(
  p_outgoing_transaction_id uuid,
  p_incoming_transaction_id uuid,
  p_subtype public.transfer_subtype default 'ACCOUNT_TO_ACCOUNT'
)
returns public.transfer_matches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_out public.transactions;
  v_in public.transactions;
  v_match public.transfer_matches;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  if p_outgoing_transaction_id = p_incoming_transaction_id then
    raise exception 'TRANSFER_LEGS_IDENTICAL' using errcode = '22023';
  end if;

  -- Ownership of BOTH legs is verified server-side. This is the check that
  -- makes a client-supplied transaction id safe to accept.
  select * into v_out from public.transactions
  where id = p_outgoing_transaction_id and user_id = v_user_id and removed_at is null;
  if not found then
    raise exception 'TRANSACTION_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into v_in from public.transactions
  where id = p_incoming_transaction_id and user_id = v_user_id and removed_at is null;
  if not found then
    raise exception 'TRANSACTION_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_out.amount <= 0 or v_in.amount >= 0 then
    raise exception 'TRANSFER_LEGS_NOT_OPPOSING' using errcode = '22023';
  end if;

  if v_out.account_id = v_in.account_id then
    raise exception 'TRANSFER_LEGS_SAME_ACCOUNT' using errcode = '22023';
  end if;

  -- Detach any live match either leg already belongs to.
  update public.transfer_matches
  set status = 'USER_REJECTED', user_rejected_at = now()
  where user_id = v_user_id
    and status <> 'USER_REJECTED'
    and (outgoing_transaction_id in (p_outgoing_transaction_id, p_incoming_transaction_id)
      or incoming_transaction_id in (p_outgoing_transaction_id, p_incoming_transaction_id));

  insert into public.transfer_matches (
    user_id, outgoing_transaction_id, incoming_transaction_id,
    confidence, detection_method, reason, subtype, status, user_confirmed_at
  )
  values (
    v_user_id, p_outgoing_transaction_id, p_incoming_transaction_id,
    1.0, 'USER_MANUAL',
    jsonb_build_array(jsonb_build_object(
      'signal', 'USER_SELECTED',
      'detail', 'Pair chosen manually in Transfer Review',
      'weight', 1.0)),
    p_subtype, 'USER_CONFIRMED', now()
  )
  on conflict (outgoing_transaction_id, incoming_transaction_id) do update
  set status = 'USER_CONFIRMED',
      subtype = excluded.subtype,
      confidence = 1.0,
      detection_method = 'USER_MANUAL',
      user_confirmed_at = now(),
      user_rejected_at = null
  returning * into v_match;

  update public.transactions
  set user_type = 'TRANSFER',
      user_transfer_subtype = p_subtype,
      user_classified_at = now(),
      transfer_match_id = v_match.id
  where user_id = v_user_id
    and id in (p_outgoing_transaction_id, p_incoming_transaction_id);

  return v_match;
end;
$$;

comment on function public.create_manual_transfer_match is
  'Pairs two transactions as an internal transfer after verifying the caller owns both legs and that they oppose one another.';

-- ---------------------------------------------------------------------------
-- Candidate lookup for "choose another match".
-- ---------------------------------------------------------------------------
create or replace function public.find_transfer_candidates(
  p_transaction_id uuid,
  p_day_window integer default 7,
  p_limit integer default 20
)
returns table (
  id uuid,
  posted_date date,
  display_name text,
  absolute_amount numeric,
  currency char(3),
  account_name text,
  institution_name text,
  amount_delta numeric,
  day_delta integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with subject as (
    select t.* from public.transactions_classified t where t.id = p_transaction_id
  )
  select
    c.id,
    c.posted_date,
    c.display_name,
    c.absolute_amount,
    c.currency,
    c.account_name,
    c.institution_name,
    round(abs(c.absolute_amount - s.absolute_amount), 2),
    abs(c.posted_date - s.posted_date)
  from public.transactions_classified c
  cross join subject s
  where c.id <> s.id
    and c.account_id <> s.account_id
    and c.removed_at is null
    and c.pending = false
    and c.direction <> s.direction
    and c.currency is not distinct from s.currency
    and c.posted_date between s.posted_date - least(greatest(p_day_window, 0), 30)
                          and s.posted_date + least(greatest(p_day_window, 0), 30)
  order by abs(c.absolute_amount - s.absolute_amount), abs(c.posted_date - s.posted_date)
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

comment on function public.find_transfer_candidates is
  'Opposing-direction transactions on other accounts that could pair with the given one. Read-only; RLS scopes it to the caller.';

revoke all on function public.confirm_transfer_match(uuid) from public, anon;
revoke all on function public.reject_transfer_match(uuid) from public, anon;
revoke all on function public.create_manual_transfer_match(uuid, uuid, public.transfer_subtype) from public, anon;

grant execute on function public.confirm_transfer_match(uuid) to authenticated;
grant execute on function public.reject_transfer_match(uuid) to authenticated;
grant execute on function public.create_manual_transfer_match(uuid, uuid, public.transfer_subtype) to authenticated;
grant execute on function public.find_transfer_candidates(uuid, integer, integer) to authenticated;
