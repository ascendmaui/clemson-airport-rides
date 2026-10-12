-- Driver instant cash-out. Additive only: a new ledger table, a partial unique
-- index for one cash-out per driver per America/New_York calendar day, and
-- service-role RPCs that claim pending trip payouts so the daily sweep cannot
-- transfer the same money twice.

create table if not exists public.driver_cashouts (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null,
  ny_day date not null default ((now() at time zone 'America/New_York')::date),
  status text not null default 'claimed'
    check (status in ('claimed', 'transferred', 'paid', 'failed')),
  method text check (method in ('instant', 'standard')),
  gross_cents integer not null default 0 check (gross_cents >= 0),
  fee_cents integer not null default 0 check (fee_cents >= 0),
  net_cents integer not null default 0 check (net_cents >= 0),
  trip_ids uuid[] not null default '{}',
  stripe_transfer_id text,
  stripe_payout_id text,
  fallback_reason text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The daily limit lives in the database. Failed attempts that never moved
-- money free the slot so the driver can try again.
create unique index if not exists driver_cashouts_one_per_ny_day
  on public.driver_cashouts (driver_id, ny_day)
  where status <> 'failed';

create index if not exists driver_cashouts_driver_created
  on public.driver_cashouts (driver_id, created_at desc);

alter table public.driver_cashouts enable row level security;
drop policy if exists driver_cashouts_own_select on public.driver_cashouts;
create policy driver_cashouts_own_select on public.driver_cashouts
  for select to authenticated using (driver_id = auth.uid());
revoke all on public.driver_cashouts from public, anon;
grant select on public.driver_cashouts to authenticated;
grant all on public.driver_cashouts to service_role;

-- Claim every due trip payout for the driver under a fresh cash-out row.
-- Raises already_cashed_out_today or zero_balance. Rows are locked so a
-- concurrent claim or sweep sees status cashout_pending, which payoutIsDue
-- treats as not due.
create or replace function public.claim_driver_cashout(p_driver uuid, p_fee_bps integer, p_fee_min_cents integer)
returns public.driver_cashouts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.driver_cashouts;
  v_gross integer;
  v_ids uuid[];
  v_fee integer;
begin
  perform pg_advisory_xact_lock(hashtext('driver_cashout:' || p_driver::text));

  if exists (
    select 1 from public.driver_cashouts
    where driver_id = p_driver
      and ny_day = (now() at time zone 'America/New_York')::date
      and status <> 'failed'
  ) then
    raise exception 'already_cashed_out_today' using errcode = 'P0001';
  end if;

  with due as (
    select t.id, greatest(0, round((t.metadata->'payout'->>'amountCents')::numeric)::integer) as cents
    from public.trips t
    where t.driver_id = p_driver
    and t.status in ('completed', 'cancelled_wait')
    and t.metadata->'payout'->>'status' in ('pending', 'failed')
    and coalesce((t.metadata->>'e2e_test')::boolean, false) = false
    and coalesce((t.metadata->'payout'->>'amountCents')::numeric, 0) > 0
    for update of t
  )
  select coalesce(sum(cents), 0)::integer, coalesce(array_agg(id), '{}')
    into v_gross, v_ids
  from due;

  if v_gross <= 0 then
    raise exception 'zero_balance' using errcode = 'P0001';
  end if;

  v_fee := greatest(coalesce(p_fee_min_cents, 0), ceil(v_gross * coalesce(p_fee_bps, 0) / 10000.0)::integer);
  if v_fee >= v_gross then
    raise exception 'balance_below_fee' using errcode = 'P0001';
  end if;

  insert into public.driver_cashouts (driver_id, gross_cents, fee_cents, net_cents, trip_ids)
  values (p_driver, v_gross, v_fee, v_gross - v_fee, v_ids)
  returning * into v_row;

  update public.trips t
     set metadata = jsonb_set(
       jsonb_set(t.metadata, '{payout,status}', '"cashout_pending"'),
       '{payout,cashoutId}', to_jsonb(v_row.id::text))
   where t.id = any(v_ids);

  update public.driver_payouts
     set status = 'cashout_pending', updated_at = now()
   where trip_id = any(v_ids);

  return v_row;
end;
$$;

-- Settle a claim. p_ok true marks the claimed trips paid under the cash-out
-- transfer. p_ok false (no money moved) returns them to pending and frees the
-- daily slot.
create or replace function public.settle_driver_cashout(
  p_cashout uuid, p_ok boolean, p_status text, p_method text,
  p_transfer text, p_payout text, p_fallback text, p_error text)
returns public.driver_cashouts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.driver_cashouts;
  v_paid_at text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select * into v_row from public.driver_cashouts where id = p_cashout for update;
  if not found then raise exception 'cashout_not_found'; end if;

  if p_ok then
    update public.trips t
       set metadata = jsonb_set(t.metadata, '{payout}',
         (t.metadata->'payout') || jsonb_build_object(
           'status', 'paid', 'pending', false, 'lastError', null,
           'stripeTransferId', p_transfer, 'paidAt', v_paid_at, 'cashoutId', p_cashout::text))
     where t.id = any(v_row.trip_ids)
       and t.metadata->'payout'->>'status' = 'cashout_pending';
    update public.driver_payouts
       set status = 'paid', stripe_transfer_id = p_transfer, last_error = null, updated_at = now()
     where trip_id = any(v_row.trip_ids);
  else
    update public.trips t
       set metadata = jsonb_set(t.metadata, '{payout,status}', '"pending"') #- '{payout,cashoutId}'
     where t.id = any(v_row.trip_ids)
       and t.metadata->'payout'->>'status' = 'cashout_pending';
    update public.driver_payouts
       set status = 'pending', updated_at = now()
     where trip_id = any(v_row.trip_ids) and status = 'cashout_pending';
  end if;

  update public.driver_cashouts
     set status = coalesce(p_status, case when p_ok then 'paid' else 'failed' end),
         method = coalesce(p_method, method),
         stripe_transfer_id = coalesce(p_transfer, stripe_transfer_id),
         stripe_payout_id = coalesce(p_payout, stripe_payout_id),
         fallback_reason = coalesce(p_fallback, fallback_reason),
         last_error = p_error,
         updated_at = now()
   where id = p_cashout
   returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.claim_driver_cashout(uuid, integer, integer) from public;
revoke all on function public.settle_driver_cashout(uuid, boolean, text, text, text, text, text, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.claim_driver_cashout(uuid, integer, integer) from anon;
    revoke all on function public.settle_driver_cashout(uuid, boolean, text, text, text, text, text, text) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.claim_driver_cashout(uuid, integer, integer) from authenticated;
    revoke all on function public.settle_driver_cashout(uuid, boolean, text, text, text, text, text, text) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.claim_driver_cashout(uuid, integer, integer) to service_role;
    grant execute on function public.settle_driver_cashout(uuid, boolean, text, text, text, text, text, text) to service_role;
  end if;
end $$;
