-- Rider credits: rider_credit_lots is the single source of truth.
-- Applied to project awktabuhijrshmsmagpq (Clemson Rides).
--
-- Why
--   apply_credit_delta (the "wallet") read and wrote credit_accounts and then
--   copied that number into profiles.credit_balance_cents. The lot trigger
--   (refresh_rider_credit_balance) writes the same column from
--   rider_credit_lots. One wallet op could overwrite a $1,000,000 lot balance
--   with the $52 wallet balance. Balances were also 32-bit.
--
-- What this does (additive / widening only; no balance is changed)
--   1. Snapshots every credit balance into credit_balance_snapshot_20261015.
--   2. Widens all credit balance columns to bigint.
--   3. Allows ledger kinds 'grant' and 'adjust' (superset of the old check).
--   4. Replaces apply_credit_delta with a bigint version that reads and writes
--      rider_credit_lots only (FIFO debit, new lot on credit), journals each
--      operation in wallet_ledger, takes a per-rider advisory lock, refuses a
--      reused idempotency key with a different rider or amount, caps one op at
--      $10M, and never touches credit_accounts or profiles directly.
--   5. Guards profiles.credit_balance_cents: any direct write is replaced with
--      the lots sum. Only the lot trigger sets it.
--   6. credit_accounts is frozen as a legacy record (kept, not read, not
--      written). Its rows are preserved untouched.
--   7. Execute on apply_credit_delta is service_role only. Client write grants
--      on the credit tables are revoked (RLS already blocked them).
--   8. Verifies every profile balance and lot is identical to the snapshot,
--      or the migration aborts.
--
-- Rollback
--   drop trigger profiles_credit_balance_derived on public.profiles;
--   drop function public.guard_profile_credit_balance();
--   drop function public.apply_credit_delta(uuid, bigint, text, uuid, text);
--   then recreate the previous integer apply_credit_delta (credit_accounts
--   based) from supabase/payment_failure_hardening.sql, with
--   insert/select on public.wallet_ledger as in prod, and
--   grant execute ... to service_role.
--   The bigint columns can stay (widening is harmless). The snapshot table can
--   be dropped once the balances are confirmed.

-- 1. Snapshot
create table if not exists public.credit_balance_snapshot_20261015 (
  source text not null,
  row_id uuid not null,
  profile_id uuid,
  cents bigint,
  taken_at timestamptz not null default now(),
  primary key (source, row_id)
);
alter table public.credit_balance_snapshot_20261015 enable row level security;
revoke all on public.credit_balance_snapshot_20261015 from anon, authenticated;

insert into public.credit_balance_snapshot_20261015 (source, row_id, profile_id, cents)
select 'profile', id, id, credit_balance_cents from public.profiles where credit_balance_cents <> 0
union all
select 'lot', id, profile_id, remaining_cents from public.rider_credit_lots
union all
select 'credit_account', user_id, user_id, balance_cents from public.credit_accounts
on conflict (source, row_id) do nothing;

-- 2. bigint
alter table public.profiles alter column credit_balance_cents type bigint;
alter table public.rider_credit_lots
  alter column load_cents type bigint,
  alter column remaining_cents type bigint;
alter table public.rider_credit_ledger
  alter column amount_cents type bigint,
  alter column discount_cents type bigint;
alter table public.credit_accounts alter column balance_cents type bigint;
alter table public.wallet_ledger
  alter column delta_cents type bigint,
  alter column balance_after type bigint;

-- 3. Ledger kinds (superset)
alter table public.rider_credit_ledger drop constraint if exists rider_credit_ledger_kind_check;
alter table public.rider_credit_ledger add constraint rider_credit_ledger_kind_check
  check (kind = any (array['purchase'::text, 'redemption'::text, 'refund'::text, 'grant'::text, 'adjust'::text]));

create index if not exists rider_credit_lots_available_idx
  on public.rider_credit_lots (profile_id, created_at, id)
  where status = 'available' and remaining_cents > 0;

-- 4. apply_credit_delta over lots
drop function if exists public.apply_credit_delta(uuid, integer, text, uuid, text);

create function public.apply_credit_delta(
  p_user_id uuid,
  p_delta_cents bigint,
  p_kind text default 'adjust',
  p_trip_id uuid default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_kind text := coalesce(nullif(btrim(p_kind), ''), 'adjust');
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_prior public.wallet_ledger%rowtype;
  v_balance bigint;
  v_need bigint;
  v_take bigint;
  v_lot record;
  v_lot_id uuid;
  v_after bigint;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_user', 'balance_cents', 0);
  end if;
  if p_delta_cents is null or abs(p_delta_cents) > 1000000000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_amount', 'balance_cents', 0);
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    return jsonb_build_object('ok', false, 'code', 'invalid_user', 'balance_cents', 0);
  end if;

  -- One credit operation per rider at a time.
  perform pg_advisory_xact_lock(hashtextextended('rider_credit:' || p_user_id::text, 0));

  select coalesce(sum(remaining_cents), 0) into v_balance
  from public.rider_credit_lots
  where profile_id = p_user_id and status = 'available' and remaining_cents > 0;

  if v_key is not null then
    select * into v_prior from public.wallet_ledger where idempotency_key = v_key;
    if found then
      if v_prior.user_id <> p_user_id or v_prior.delta_cents <> p_delta_cents then
        return jsonb_build_object('ok', false, 'code', 'idempotency_conflict', 'balance_cents', v_balance);
      end if;
      return jsonb_build_object('ok', true, 'duplicate', true, 'balance_cents', v_balance);
    end if;
  end if;

  if p_delta_cents = 0 then
    return jsonb_build_object('ok', true, 'duplicate', false, 'balance_cents', v_balance);
  end if;

  if p_delta_cents > 0 then
    insert into public.rider_credit_lots (profile_id, pack_id, load_cents, discount_bps, remaining_cents, status)
    values (p_user_id, 'wallet:' || v_kind, p_delta_cents, 0, p_delta_cents, 'available')
    returning id into v_lot_id;
    insert into public.rider_credit_ledger (profile_id, lot_id, kind, amount_cents, discount_cents, trip_id, note)
    values (p_user_id, v_lot_id,
      case when v_kind ~* '(reversal|refund|restore)' then 'refund' else 'grant' end,
      p_delta_cents, 0, p_trip_id, coalesce(v_key, v_kind));
  else
    v_need := -p_delta_cents;
    if v_balance < v_need then
      return jsonb_build_object('ok', false, 'code', 'credits_insufficient', 'balance_cents', v_balance);
    end if;
    for v_lot in
      select id, remaining_cents
      from public.rider_credit_lots
      where profile_id = p_user_id and status = 'available' and remaining_cents > 0
      order by created_at, id
      for update
    loop
      exit when v_need = 0;
      v_take := least(v_need, v_lot.remaining_cents);
      update public.rider_credit_lots
      set remaining_cents = remaining_cents - v_take,
          status = case when remaining_cents - v_take = 0 then 'exhausted' else 'available' end
      where id = v_lot.id;
      insert into public.rider_credit_ledger (profile_id, lot_id, kind, amount_cents, discount_cents, trip_id, note)
      values (p_user_id, v_lot.id, 'redemption', v_take, 0, p_trip_id, coalesce(v_key, v_kind));
      v_need := v_need - v_take;
    end loop;
    if v_need > 0 then
      raise exception 'rider credit lots changed during debit';
    end if;
  end if;

  select coalesce(sum(remaining_cents), 0) into v_after
  from public.rider_credit_lots
  where profile_id = p_user_id and status = 'available' and remaining_cents > 0;

  insert into public.wallet_ledger (user_id, delta_cents, balance_after, trip_id, kind, idempotency_key)
  values (p_user_id, p_delta_cents, v_after, p_trip_id, v_kind, v_key);

  return jsonb_build_object('ok', true, 'duplicate', false, 'balance_cents', v_after);
end;
$$;

revoke all on function public.apply_credit_delta(uuid, bigint, text, uuid, text) from public, anon, authenticated;
grant execute on function public.apply_credit_delta(uuid, bigint, text, uuid, text) to service_role;

-- 5. profiles.credit_balance_cents is derived from lots only
create or replace function public.guard_profile_credit_balance()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Depth 1 = a direct write to profiles. The lot trigger writes at depth 2.
  if pg_trigger_depth() <= 1
     and (tg_op = 'INSERT' or new.credit_balance_cents is distinct from old.credit_balance_cents) then
    new.credit_balance_cents := (
      select coalesce(sum(remaining_cents), 0)
      from public.rider_credit_lots
      where profile_id = new.id and status = 'available'
    );
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_profile_credit_balance() from public, anon, authenticated, service_role;

drop trigger if exists profiles_credit_balance_derived on public.profiles;
create trigger profiles_credit_balance_derived
  before insert or update of credit_balance_cents on public.profiles
  for each row execute function public.guard_profile_credit_balance();

-- 6. Legacy wallet balance table: frozen, kept as a record
comment on table public.credit_accounts is
  'LEGACY (frozen 2026-10-15). Not read or written by the app. rider_credit_lots is the source of truth; see migration 20261015120000.';
comment on column public.profiles.credit_balance_cents is
  'Derived: sum of available rider_credit_lots.remaining_cents. Set only by refresh_rider_credit_balance.';

-- 7. Client write grants (RLS already blocked these)
revoke insert, update, delete, truncate on public.credit_accounts from anon, authenticated;
revoke insert, update, delete, truncate on public.wallet_ledger from anon, authenticated;
revoke insert, update, delete, truncate on public.rider_credit_lots from anon, authenticated;
revoke insert, update, delete, truncate on public.rider_credit_ledger from anon, authenticated;

-- 8. Verify nothing moved
do $$
declare
  v_bad int;
begin
  select count(*) into v_bad
  from public.credit_balance_snapshot_20261015 s
  left join public.profiles p on s.source = 'profile' and p.id = s.row_id
  left join public.rider_credit_lots l on s.source = 'lot' and l.id = s.row_id
  left join public.credit_accounts a on s.source = 'credit_account' and a.user_id = s.row_id
  where s.cents is distinct from case s.source
    when 'profile' then p.credit_balance_cents
    when 'lot' then l.remaining_cents
    when 'credit_account' then a.balance_cents
  end;
  if v_bad > 0 then
    raise exception 'credit balance verification failed: % rows changed', v_bad;
  end if;
  if exists (
    select 1 from public.profiles p
    where p.credit_balance_cents is distinct from (
      select coalesce(sum(remaining_cents), 0) from public.rider_credit_lots l
      where l.profile_id = p.id and l.status = 'available'
    )
  ) then
    raise exception 'profiles.credit_balance_cents does not match the lots sum';
  end if;
end;
$$;
