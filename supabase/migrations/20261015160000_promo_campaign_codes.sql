-- Admin-generated promo codes (rider and driver). Additive only.
-- Do not apply from an agent run: review, then apply with the normal ops flow.
--
-- Builds on, does not replace:
--   promo_codes / rider_referrals (rider_social, supabase/rider_social_promo.sql)
--     stay the rider-to-rider program. A campaign code may not reuse a
--     rider_social code (checked server-side and by promo_campaign_code_unique_guard).
--   weekly_coupon_drops (Friday drop) stays the idempotency claim for the email.
--   promo_rules (legacy, 0 rows, public read policy) is left untouched and unused.
--     It is NOT reused because its anon SELECT policy would expose every code.
--
-- Money rules (enforced in server code, recorded here):
--   * Rider discounts lower the card hold and the captured fare only.
--     trips.fare_cents stays the pre-promo fare, so driver pay (80% / the
--     accept-locked driver_net_cents) never changes. The platform funds the
--     discount (platform_funded_cents on the redemption).
--   * Driver codes are recorded at driver signup as claimed. Nothing is paid
--     from here; any payout must go through payout_approval_requests (#554).
--
-- Limits: max_redemptions overall, per_account_limit per account, and the same
-- limit per device id and per Stripe card fingerprint (limit_per_device /
-- limit_per_card, on by default). One promo per trip (unique trip_id).
--
-- Redemption is atomic: every write path locks the code row FOR UPDATE and
-- re-counts before inserting. It is idempotent: one redemption per trip
-- (unique trip_id) and a unique idempotency_key per claim.
--
-- RLS: both tables are service_role only. The rider/driver apps go through
-- /api/promo/* and the admin UI through /api/admin?action=promo-* which check
-- the sole promo admin (johnmatveyev@gmail.com) server-side.
--
-- Down (reversible):
--   drop trigger if exists trips_promo_status_sync on public.trips;
--   drop trigger if exists promo_campaign_codes_unique_guard on public.promo_campaign_codes;
--   drop function if exists public.promo_campaign_code_unique_guard();
--   drop function if exists public.promo__fail(uuid, text, text);
--   drop function if exists public.promo__unusable_reason(public.promo_campaign_codes, uuid, text, integer, integer, text, text);
--   drop function if exists public.promo_trip_status_sync();
--   drop function if exists public.promo_release_for_trip(uuid, text);
--   drop function if exists public.promo_finalize_for_trip(uuid, integer, integer);
--   drop function if exists public.promo_reserve_for_trip(uuid, text, uuid, integer, text, text);
--   drop function if exists public.promo_claim_code(uuid, text, text, text);
--   drop function if exists public.promo_check_code(uuid, text, text, integer);
--   drop function if exists public.promo_attempts_blocked(uuid);
--   drop function if exists public.promo_compute_discount(text, integer, integer, integer, integer, integer);
--   drop table if exists public.promo_code_attempts, public.promo_code_admin_events,
--     public.promo_code_redemptions, public.promo_campaign_codes;

create table if not exists public.promo_campaign_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{4,16}$'),
  side text not null check (side in ('rider', 'driver')),
  discount_type text not null check (discount_type in ('percent', 'flat')),
  percent_off_bps integer not null default 0 check (percent_off_bps between 0 and 5000),
  amount_off_cents integer not null default 0 check (amount_off_cents between 0 and 5000),
  max_discount_cents integer check (max_discount_cents is null or max_discount_cents between 1 and 5000),
  min_trip_cents integer not null default 0 check (min_trip_cents between 0 and 100000),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  max_redemptions integer not null check (max_redemptions between 1 and 10000),
  per_account_limit integer not null default 1 check (per_account_limit between 1 and 10),
  -- The per-account limit also applies per device and per card fingerprint.
  limit_per_device boolean not null default true,
  limit_per_card boolean not null default true,
  budget_cents integer check (budget_cents is null or budget_cents between 1 and 5000000),
  active boolean not null default true,
  public_listing boolean not null default false,
  campaign text check (campaign is null or char_length(campaign) <= 80),
  notes text check (notes is null or char_length(notes) <= 500),
  batch_id uuid,
  created_by uuid,
  created_by_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promo_campaign_codes_amount_matches_type check (
    (discount_type = 'percent' and percent_off_bps > 0 and amount_off_cents = 0)
    or (discount_type = 'flat' and amount_off_cents > 0 and percent_off_bps = 0)
  ),
  constraint promo_campaign_codes_driver_flat_only check (side = 'rider' or discount_type = 'flat'),
  constraint promo_campaign_codes_window check (expires_at > starts_at),
  constraint promo_campaign_codes_max_lifetime check (expires_at <= starts_at + interval '366 days')
);

create index if not exists promo_campaign_codes_active_idx
  on public.promo_campaign_codes (side, active, expires_at);
create index if not exists promo_campaign_codes_batch_idx
  on public.promo_campaign_codes (batch_id) where batch_id is not null;

comment on table public.promo_campaign_codes is
  'Admin-generated promo codes. Rider: percent or flat off the rider fare (hold and capture). Driver: flat signup incentive, recorded only. Service role only.';

create table if not exists public.promo_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.promo_campaign_codes(id) on delete restrict,
  code text not null,
  side text not null check (side in ('rider', 'driver')),
  profile_id uuid not null,
  trip_id uuid unique,
  status text not null check (status in ('claimed', 'reserved', 'redeemed', 'released', 'void')),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  fare_cents integer check (fare_cents is null or fare_cents >= 0),
  platform_funded_cents integer not null default 0 check (platform_funded_cents >= 0),
  device_id text check (device_id is null or char_length(device_id) <= 128),
  card_fingerprint text check (card_fingerprint is null or char_length(card_fingerprint) <= 64),
  idempotency_key text not null unique,
  claimed_at timestamptz,
  reserved_at timestamptz,
  redeemed_at timestamptz,
  released_at timestamptz,
  release_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists promo_code_redemptions_code_status_idx
  on public.promo_code_redemptions (code_id, status);
create index if not exists promo_code_redemptions_device_idx
  on public.promo_code_redemptions (code_id, device_id) where device_id is not null;
create index if not exists promo_code_redemptions_card_idx
  on public.promo_code_redemptions (code_id, card_fingerprint) where card_fingerprint is not null;
create index if not exists promo_code_redemptions_profile_idx
  on public.promo_code_redemptions (profile_id, status, created_at);

comment on table public.promo_code_redemptions is
  'One row per claim or use. claimed (signup) -> reserved (trip booked, hold placed) -> redeemed (fare captured). released/void do not count toward limits.';
comment on column public.promo_code_redemptions.platform_funded_cents is
  'The discount comes out of the platform share. Driver pay is computed on the pre-promo fare.';

create table if not exists public.promo_code_admin_events (
  id uuid primary key default gen_random_uuid(),
  code_id uuid references public.promo_campaign_codes(id) on delete set null,
  batch_id uuid,
  action text not null check (action in ('created', 'updated', 'deactivated', 'exported')),
  actor_id uuid,
  actor_email text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.promo_code_attempts (
  id bigint generated always as identity primary key,
  profile_id uuid not null,
  code text not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists promo_code_attempts_profile_idx
  on public.promo_code_attempts (profile_id, created_at desc);

-- A campaign code may not shadow a rider_social code (one entry box serves both).
create or replace function public.promo_campaign_code_unique_guard()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_taken boolean := false;
begin
  NEW.code := upper(NEW.code);
  if to_regclass('public.promo_codes') is not null then
    execute 'select exists (select 1 from public.promo_codes where upper(code) = $1)' into v_taken using NEW.code;
  end if;
  if v_taken then
    raise exception 'promo_code_taken' using errcode = '23505';
  end if;
  NEW.updated_at := now();
  return NEW;
end;
$$;

drop trigger if exists promo_campaign_codes_unique_guard on public.promo_campaign_codes;
create trigger promo_campaign_codes_unique_guard
  before insert or update of code on public.promo_campaign_codes
  for each row
  execute function public.promo_campaign_code_unique_guard();

-- ---------------------------------------------------------------------------
-- RLS: locked down. No anon/authenticated access at all.
-- ---------------------------------------------------------------------------

alter table public.promo_campaign_codes enable row level security;
alter table public.promo_code_redemptions enable row level security;
alter table public.promo_code_admin_events enable row level security;
alter table public.promo_code_attempts enable row level security;

revoke all on public.promo_campaign_codes from public, anon, authenticated;
revoke all on public.promo_code_redemptions from public, anon, authenticated;
revoke all on public.promo_code_admin_events from public, anon, authenticated;
revoke all on public.promo_code_attempts from public, anon, authenticated;
grant all on public.promo_campaign_codes to service_role;
grant all on public.promo_code_redemptions to service_role;
grant all on public.promo_code_admin_events to service_role;
grant all on public.promo_code_attempts to service_role;

drop policy if exists promo_campaign_codes_service_role on public.promo_campaign_codes;
create policy promo_campaign_codes_service_role on public.promo_campaign_codes
  for all to service_role using (true) with check (true);
drop policy if exists promo_code_redemptions_service_role on public.promo_code_redemptions;
create policy promo_code_redemptions_service_role on public.promo_code_redemptions
  for all to service_role using (true) with check (true);
drop policy if exists promo_code_admin_events_service_role on public.promo_code_admin_events;
create policy promo_code_admin_events_service_role on public.promo_code_admin_events
  for all to service_role using (true) with check (true);
drop policy if exists promo_code_attempts_service_role on public.promo_code_attempts;
create policy promo_code_attempts_service_role on public.promo_code_attempts
  for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Discount math. Mirrors shared/promoCodes.js promoDiscountCents.
-- ---------------------------------------------------------------------------

create or replace function public.promo_compute_discount(
  p_type text, p_bps integer, p_amount integer, p_max integer, p_min_trip integer, p_fare integer
) returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when coalesce(p_fare, 0) <= 0 then 0
    when coalesce(p_fare, 0) < coalesce(p_min_trip, 0) then 0
    else least(
      p_fare,
      case
        when p_type = 'percent' then least(
          round(p_fare::numeric * greatest(coalesce(p_bps, 0), 0) / 10000)::integer,
          coalesce(p_max, 2147483647)
        )
        when p_type = 'flat' then greatest(coalesce(p_amount, 0), 0)
        else 0
      end
    )
  end;
$$;

-- Brute-force guard: 10 failed lookups per account per hour.
create or replace function public.promo_attempts_blocked(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*) >= 10 from public.promo_code_attempts
  where profile_id = p_profile and created_at > now() - interval '1 hour';
$$;

create or replace function public.promo__fail(p_profile uuid, p_code text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_reason in ('not_found', 'wrong_side') then
    insert into public.promo_code_attempts (profile_id, code, reason)
    values (p_profile, left(coalesce(p_code, ''), 32), p_reason);
  end if;
  return jsonb_build_object('ok', false, 'reason', p_reason);
end;
$$;

-- Validate one code for one account. Locks the code row when p_lock is true.
-- Returns null when the code is usable, else the reason.
create or replace function public.promo__unusable_reason(
  c public.promo_campaign_codes, p_profile uuid, p_side text, p_fare integer, p_discount integer,
  p_device text default null, p_card text default null
) returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_used integer;
  v_mine integer;
  v_spent integer;
begin
  if c.side <> p_side then return 'wrong_side'; end if;
  if not c.active then return 'inactive'; end if;
  if c.starts_at > now() then return 'not_started'; end if;
  if c.expires_at <= now() then return 'expired'; end if;
  select count(*) into v_used from public.promo_code_redemptions
    where code_id = c.id and status in ('claimed', 'reserved', 'redeemed');
  if v_used >= c.max_redemptions then return 'max_redemptions'; end if;
  select count(*) into v_mine from public.promo_code_redemptions
    where code_id = c.id and profile_id = p_profile and status in ('claimed', 'reserved', 'redeemed');
  if v_mine >= c.per_account_limit then return 'per_account_limit'; end if;
  if c.limit_per_device and p_device is not null then
    select count(*) into v_mine from public.promo_code_redemptions
      where code_id = c.id and device_id = p_device and profile_id <> p_profile
        and status in ('claimed', 'reserved', 'redeemed');
    if v_mine >= c.per_account_limit then return 'device_limit'; end if;
  end if;
  if c.limit_per_card and p_card is not null then
    select count(*) into v_mine from public.promo_code_redemptions
      where code_id = c.id and card_fingerprint = p_card and profile_id <> p_profile
        and status in ('claimed', 'reserved', 'redeemed');
    if v_mine >= c.per_account_limit then return 'card_limit'; end if;
  end if;
  if p_fare is not null and p_fare < c.min_trip_cents then return 'below_minimum'; end if;
  if c.budget_cents is not null and p_discount is not null then
    select coalesce(sum(discount_cents), 0) into v_spent from public.promo_code_redemptions
      where code_id = c.id and status in ('reserved', 'redeemed');
    if v_spent + p_discount > c.budget_cents then return 'budget_exhausted'; end if;
  end if;
  return null;
end;
$$;

-- Preview only. Writes nothing except a failed-attempt row.
create or replace function public.promo_check_code(
  p_profile uuid, p_code text, p_side text, p_fare_cents integer default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.promo_campaign_codes;
  v_reason text;
  v_discount integer;
begin
  if p_profile is null then return jsonb_build_object('ok', false, 'reason', 'sign_in_required'); end if;
  if public.promo_attempts_blocked(p_profile) then
    return jsonb_build_object('ok', false, 'reason', 'too_many_attempts');
  end if;
  select * into c from public.promo_campaign_codes where code = upper(p_code);
  if not found then return public.promo__fail(p_profile, p_code, 'not_found'); end if;
  v_discount := case when p_fare_cents is null then null else public.promo_compute_discount(
    c.discount_type, c.percent_off_bps, c.amount_off_cents, c.max_discount_cents, c.min_trip_cents, p_fare_cents) end;
  v_reason := public.promo__unusable_reason(c, p_profile, p_side, p_fare_cents, v_discount);
  if v_reason is not null then return public.promo__fail(p_profile, p_code, v_reason); end if;
  return jsonb_build_object(
    'ok', true, 'code', c.code, 'side', c.side, 'discount_type', c.discount_type,
    'percent_off_bps', c.percent_off_bps, 'amount_off_cents', c.amount_off_cents,
    'max_discount_cents', c.max_discount_cents, 'min_trip_cents', c.min_trip_cents,
    'expires_at', c.expires_at, 'discount_cents', v_discount
  );
end;
$$;

-- Signup claim (rider or driver). Idempotent per (account, code).
create or replace function public.promo_claim_code(p_profile uuid, p_code text, p_side text, p_device_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.promo_campaign_codes;
  v_reason text;
  r public.promo_code_redemptions;
begin
  if p_profile is null then return jsonb_build_object('ok', false, 'reason', 'sign_in_required'); end if;
  if public.promo_attempts_blocked(p_profile) then
    return jsonb_build_object('ok', false, 'reason', 'too_many_attempts');
  end if;
  select * into c from public.promo_campaign_codes where code = upper(p_code) for update;
  if not found then return public.promo__fail(p_profile, p_code, 'not_found'); end if;
  select * into r from public.promo_code_redemptions
    where code_id = c.id and profile_id = p_profile and status = 'claimed'
    order by created_at limit 1;
  if found then
    return jsonb_build_object('ok', true, 'duplicate', true, 'redemption_id', r.id, 'code', c.code,
      'side', c.side, 'status', r.status, 'discount_cents', r.discount_cents);
  end if;
  v_reason := public.promo__unusable_reason(c, p_profile, p_side, null, null, p_device_id, null);
  if v_reason is not null then return public.promo__fail(p_profile, p_code, v_reason); end if;
  insert into public.promo_code_redemptions (
    code_id, code, side, profile_id, status, discount_cents, idempotency_key, claimed_at, device_id
  ) values (
    c.id, c.code, c.side, p_profile, 'claimed',
    case when c.side = 'driver' then c.amount_off_cents else 0 end,
    'claim:' || p_profile || ':' || c.id || ':' || (
      select count(*) from public.promo_code_redemptions where code_id = c.id and profile_id = p_profile
    ),
    now(), nullif(left(coalesce(p_device_id, ''), 128), '')
  ) returning * into r;
  return jsonb_build_object('ok', true, 'duplicate', false, 'redemption_id', r.id, 'code', c.code,
    'side', c.side, 'status', r.status, 'discount_cents', r.discount_cents);
end;
$$;

-- Booking: attach one rider code to one trip. p_code null uses the oldest
-- claimed signup code. Idempotent on trip_id. Locks the code row.
create or replace function public.promo_reserve_for_trip(
  p_profile uuid, p_code text, p_trip_id uuid, p_fare_cents integer,
  p_device_id text default null, p_card_fingerprint text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  c public.promo_campaign_codes;
  r public.promo_code_redemptions;
  v_reason text;
  v_discount integer;
  v_code text := nullif(upper(coalesce(p_code, '')), '');
  v_device text := nullif(left(coalesce(p_device_id, ''), 128), '');
  v_card text := nullif(left(coalesce(p_card_fingerprint, ''), 64), '');
begin
  if p_profile is null or p_trip_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_request');
  end if;
  select * into r from public.promo_code_redemptions where trip_id = p_trip_id;
  if found then
    if r.profile_id <> p_profile then return jsonb_build_object('ok', false, 'reason', 'invalid_request'); end if;
    select * into c from public.promo_campaign_codes where id = r.code_id;
    return jsonb_build_object('ok', true, 'duplicate', true, 'redemption_id', r.id, 'code', r.code,
      'status', r.status, 'discount_cents', r.discount_cents, 'discount_type', c.discount_type,
      'percent_off_bps', c.percent_off_bps, 'amount_off_cents', c.amount_off_cents,
      'max_discount_cents', c.max_discount_cents, 'min_trip_cents', c.min_trip_cents, 'code_id', c.id);
  end if;

  if v_code is null then
    select r2.* into r from public.promo_code_redemptions r2
      join public.promo_campaign_codes c2 on c2.id = r2.code_id
      where r2.profile_id = p_profile and r2.status = 'claimed' and r2.side = 'rider'
        and c2.active and c2.starts_at <= now() and c2.expires_at > now()
        and p_fare_cents >= c2.min_trip_cents
      order by r2.created_at limit 1;
    if not found then return jsonb_build_object('ok', false, 'reason', 'no_code'); end if;
    v_code := r.code;
  elsif public.promo_attempts_blocked(p_profile) then
    return jsonb_build_object('ok', false, 'reason', 'too_many_attempts');
  end if;

  select * into c from public.promo_campaign_codes where code = v_code for update;
  if not found then return public.promo__fail(p_profile, v_code, 'not_found'); end if;
  v_discount := public.promo_compute_discount(
    c.discount_type, c.percent_off_bps, c.amount_off_cents, c.max_discount_cents, c.min_trip_cents, p_fare_cents);

  -- A claimed signup row for this code is converted, not double counted.
  select * into r from public.promo_code_redemptions
    where code_id = c.id and profile_id = p_profile and status = 'claimed'
    order by created_at limit 1 for update;
  if found then
    if c.side <> 'rider' then return public.promo__fail(p_profile, v_code, 'wrong_side'); end if;
    if not c.active then return jsonb_build_object('ok', false, 'reason', 'inactive'); end if;
    if c.expires_at <= now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
    if p_fare_cents < c.min_trip_cents then return jsonb_build_object('ok', false, 'reason', 'below_minimum'); end if;
    if c.limit_per_card and v_card is not null and (
      select count(*) from public.promo_code_redemptions
      where code_id = c.id and card_fingerprint = v_card and profile_id <> p_profile
        and status in ('claimed', 'reserved', 'redeemed')) >= c.per_account_limit then
      return jsonb_build_object('ok', false, 'reason', 'card_limit');
    end if;
    if c.budget_cents is not null and (
      select coalesce(sum(discount_cents), 0) from public.promo_code_redemptions
      where code_id = c.id and status in ('reserved', 'redeemed')) + v_discount > c.budget_cents then
      return jsonb_build_object('ok', false, 'reason', 'budget_exhausted');
    end if;
    update public.promo_code_redemptions set
      status = 'reserved', trip_id = p_trip_id, discount_cents = v_discount, fare_cents = p_fare_cents,
      platform_funded_cents = v_discount, reserved_at = now(), updated_at = now(),
      device_id = coalesce(r.device_id, v_device), card_fingerprint = v_card
    where id = r.id returning * into r;
  else
    v_reason := public.promo__unusable_reason(c, p_profile, 'rider', p_fare_cents, v_discount, v_device, v_card);
    if v_reason is not null then return public.promo__fail(p_profile, v_code, v_reason); end if;
    if v_discount <= 0 then return jsonb_build_object('ok', false, 'reason', 'below_minimum'); end if;
    insert into public.promo_code_redemptions (
      code_id, code, side, profile_id, trip_id, status, discount_cents, fare_cents,
      platform_funded_cents, idempotency_key, reserved_at, device_id, card_fingerprint
    ) values (
      c.id, c.code, 'rider', p_profile, p_trip_id, 'reserved', v_discount, p_fare_cents,
      v_discount, 'trip:' || p_trip_id, now(), v_device, v_card
    ) returning * into r;
  end if;

  return jsonb_build_object('ok', true, 'duplicate', false, 'redemption_id', r.id, 'code', c.code,
    'status', r.status, 'discount_cents', r.discount_cents, 'discount_type', c.discount_type,
    'percent_off_bps', c.percent_off_bps, 'amount_off_cents', c.amount_off_cents,
    'max_discount_cents', c.max_discount_cents, 'min_trip_cents', c.min_trip_cents, 'code_id', c.id);
end;
$$;

-- Fare captured: record the discount actually given. Idempotent.
create or replace function public.promo_finalize_for_trip(
  p_trip_id uuid, p_discount_cents integer, p_fare_cents integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.promo_code_redemptions;
begin
  select * into r from public.promo_code_redemptions where trip_id = p_trip_id for update;
  if not found then return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'no_promo'); end if;
  if r.status not in ('reserved', 'redeemed') then
    return jsonb_build_object('ok', false, 'reason', 'not_reserved', 'status', r.status);
  end if;
  update public.promo_code_redemptions set
    status = 'redeemed',
    discount_cents = greatest(coalesce(p_discount_cents, r.discount_cents), 0),
    platform_funded_cents = greatest(coalesce(p_discount_cents, r.discount_cents), 0),
    fare_cents = coalesce(p_fare_cents, r.fare_cents),
    redeemed_at = coalesce(r.redeemed_at, now()),
    updated_at = now()
  where id = r.id returning * into r;
  return jsonb_build_object('ok', true, 'redemption_id', r.id, 'status', r.status, 'discount_cents', r.discount_cents);
end;
$$;

-- Trip canceled: a signup claim goes back to claimed; a booking-time code is released.
create or replace function public.promo_release_for_trip(p_trip_id uuid, p_reason text default 'trip_canceled')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r public.promo_code_redemptions;
begin
  select * into r from public.promo_code_redemptions where trip_id = p_trip_id for update;
  if not found then return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'no_promo'); end if;
  if r.status <> 'reserved' then return jsonb_build_object('ok', true, 'skipped', true, 'status', r.status); end if;
  if r.claimed_at is not null then
    update public.promo_code_redemptions set
      status = 'claimed', trip_id = null, discount_cents = 0, platform_funded_cents = 0, fare_cents = null,
      reserved_at = null, release_reason = left(p_reason, 80), updated_at = now()
    where id = r.id returning * into r;
  else
    update public.promo_code_redemptions set
      status = 'released', discount_cents = 0, platform_funded_cents = 0,
      released_at = now(), release_reason = left(p_reason, 80), updated_at = now()
    where id = r.id returning * into r;
  end if;
  return jsonb_build_object('ok', true, 'redemption_id', r.id, 'status', r.status);
end;
$$;

-- Every cancel path (rider, driver, sweeps, timeouts) and completion keep the
-- redemption in step with the trip without each caller remembering to.
create or replace function public.promo_trip_status_sync()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if NEW.status::text is distinct from OLD.status::text then
    if NEW.status::text in ('canceled', 'cancelled', 'canceled_midride', 'cancelled_wait', 'expired', 'no_drivers') then
      perform public.promo_release_for_trip(NEW.id, 'trip_' || NEW.status::text);
    elsif NEW.status::text = 'completed' then
      update public.promo_code_redemptions
        set status = 'redeemed', redeemed_at = coalesce(redeemed_at, now()), updated_at = now()
        where trip_id = NEW.id and status = 'reserved';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trips_promo_status_sync on public.trips;
create trigger trips_promo_status_sync
  after update of status on public.trips
  for each row
  execute function public.promo_trip_status_sync();

-- Function grants: service_role only (the server). Nothing is client callable.
revoke all on function public.promo_compute_discount(text, integer, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.promo_attempts_blocked(uuid) from public, anon, authenticated;
revoke all on function public.promo__fail(uuid, text, text) from public, anon, authenticated;
revoke all on function public.promo__unusable_reason(public.promo_campaign_codes, uuid, text, integer, integer, text, text) from public, anon, authenticated;
revoke all on function public.promo_check_code(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.promo_claim_code(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.promo_reserve_for_trip(uuid, text, uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public.promo_finalize_for_trip(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.promo_release_for_trip(uuid, text) from public, anon, authenticated;
revoke all on function public.promo_trip_status_sync() from public, anon, authenticated;
revoke all on function public.promo_campaign_code_unique_guard() from public, anon, authenticated;
grant execute on function public.promo_compute_discount(text, integer, integer, integer, integer, integer) to service_role;
grant execute on function public.promo_check_code(uuid, text, text, integer) to service_role;
grant execute on function public.promo_claim_code(uuid, text, text, text) to service_role;
grant execute on function public.promo_reserve_for_trip(uuid, text, uuid, integer, text, text) to service_role;
grant execute on function public.promo_finalize_for_trip(uuid, integer, integer) to service_role;
grant execute on function public.promo_release_for_trip(uuid, text) to service_role;
