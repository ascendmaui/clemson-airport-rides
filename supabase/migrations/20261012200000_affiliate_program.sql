-- Affiliate program (additive only). Partners: students, campus orgs, local
-- businesses, influencers. Links: clemsonrides.com/r/CODE.
-- Qualifying event: referred rider's first completed ride / referred driver's
-- first completed trip, evaluated by an AFTER UPDATE trigger on trips that can
-- never block a trip from completing. Rates are placeholders in affiliate_config.

create table if not exists public.affiliate_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.affiliate_config (key, value) values ('rates', jsonb_build_object(
  'placeholder', true,
  'currency', 'usd',
  'rider_first_ride_cents', 500,
  'driver_first_trip_cents', 2500,
  'partner_type_bps', jsonb_build_object('student', 10000, 'campus_org', 10000, 'local_business', 10000, 'influencer', 10000),
  'hold_days', 14,
  'monthly_cap', 50,
  'min_payout_cents', 1000
)) on conflict (key) do nothing;

create table if not exists public.affiliates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  code text not null unique check (code ~ '^[A-Z0-9]{4,16}$'),
  partner_type text not null check (partner_type in ('student','campus_org','local_business','influencer')),
  display_name text not null,
  contact_email text not null,
  phone text,
  org_name text,
  website text,
  audience text,
  status text not null default 'pending' check (status in ('pending','active','paused','rejected')),
  payout_method text not null default 'ride_credit' check (payout_method in ('ride_credit','stripe_connect')),
  stripe_account_id text,
  admin_note text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.affiliate_clicks (
  id bigserial primary key,
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  device_hash text,
  ip_hash text,
  user_agent text,
  landing text,
  created_at timestamptz not null default now()
);
create index if not exists affiliate_clicks_affiliate_idx on public.affiliate_clicks (affiliate_id, created_at desc);
create index if not exists affiliate_clicks_device_idx on public.affiliate_clicks (affiliate_id, device_hash, created_at desc);

create table if not exists public.affiliate_attributions (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  referred_user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('rider','driver')),
  device_hash text,
  phone_norm text,
  payment_fingerprint text,
  status text not null default 'signed_up' check (status in ('signed_up','qualified','rejected')),
  reject_reason text,
  qualifying_trip_id uuid,
  qualified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (referred_user_id, role)
);
create index if not exists affiliate_attributions_affiliate_idx on public.affiliate_attributions (affiliate_id, status);
create index if not exists affiliate_attributions_device_idx on public.affiliate_attributions (device_hash) where device_hash is not null;
create index if not exists affiliate_attributions_phone_idx on public.affiliate_attributions (phone_norm) where phone_norm is not null;

create table if not exists public.affiliate_payout_batches (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'draft' check (status in ('draft','approved','paid','failed','canceled')),
  total_cents integer not null default 0,
  entry_count integer not null default 0,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  paid_at timestamptz,
  notes text,
  result jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.affiliate_ledger (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  attribution_id uuid unique references public.affiliate_attributions(id) on delete set null,
  kind text not null check (kind in ('referral_rider','referral_driver','adjustment')),
  amount_cents integer not null check (amount_cents >= 0),
  status text not null default 'pending' check (status in ('pending','approved','paid','void')),
  batch_id uuid references public.affiliate_payout_batches(id) on delete set null,
  payout_method text,
  payout_ref text,
  note text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  paid_at timestamptz
);
create index if not exists affiliate_ledger_affiliate_idx on public.affiliate_ledger (affiliate_id, status);
create index if not exists affiliate_ledger_batch_idx on public.affiliate_ledger (batch_id);

-- RLS: clients only read their own affiliate row and ledger. Everything else
-- goes through the service-role API.
alter table public.affiliate_config enable row level security;
alter table public.affiliates enable row level security;
alter table public.affiliate_clicks enable row level security;
alter table public.affiliate_attributions enable row level security;
alter table public.affiliate_payout_batches enable row level security;
alter table public.affiliate_ledger enable row level security;

drop policy if exists affiliates_select_own on public.affiliates;
create policy affiliates_select_own on public.affiliates for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists affiliate_ledger_select_own on public.affiliate_ledger;
create policy affiliate_ledger_select_own on public.affiliate_ledger for select to authenticated
  using (exists (select 1 from public.affiliates a where a.id = affiliate_ledger.affiliate_id and a.user_id = (select auth.uid())));

revoke all on public.affiliate_config, public.affiliate_clicks, public.affiliate_attributions, public.affiliate_payout_batches from anon, authenticated;
revoke insert, update, delete on public.affiliates, public.affiliate_ledger from anon, authenticated;
revoke all on public.affiliates, public.affiliate_ledger from anon;

-- Qualification ---------------------------------------------------------
create or replace function public.affiliate_is_e2e_user(p_user uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select email ~* '^e2e\+[a-z0-9._-]+@clemsonrides\.com$' from public.profiles where id = p_user), false)
      or coalesce((select (raw_app_meta_data->>'e2e_test')::boolean from auth.users where id = p_user), false)
$$;

create or replace function public.affiliate_qualify_one(p_trip public.trips, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  att public.affiliate_attributions;
  aff public.affiliates;
  rates jsonb;
  prior int;
  dup boolean;
  v_phone text;
  counterparty uuid;
  amount int;
  cap int;
  month_count int;
begin
  if p_user is null then return; end if;
  select * into att from public.affiliate_attributions
    where referred_user_id = p_user and role = p_role and status = 'signed_up' for update;
  if not found then return; end if;
  select * into aff from public.affiliates where id = att.affiliate_id;

  -- E2E harness accounts/trips never qualify.
  if public.affiliate_is_e2e_user(p_user) then
    update public.affiliate_attributions set status = 'rejected', reject_reason = 'e2e_test' where id = att.id;
    return;
  end if;
  if coalesce((p_trip.metadata->>'e2e_test')::boolean, false)
     or public.affiliate_is_e2e_user(p_trip.rider_id) or public.affiliate_is_e2e_user(p_trip.driver_id) then
    return; -- leave signed_up; a real first trip can still qualify
  end if;

  -- First completed ride/trip only.
  if p_role = 'rider' then
    select count(*) into prior from public.trips where rider_id = p_user and status = 'completed' and id <> p_trip.id;
    counterparty := p_trip.driver_id;
  else
    select count(*) into prior from public.trips where driver_id = p_user and status = 'completed' and id <> p_trip.id;
    counterparty := p_trip.rider_id;
  end if;
  if prior > 0 then
    update public.affiliate_attributions set status = 'rejected', reject_reason = 'not_first_trip', qualifying_trip_id = p_trip.id where id = att.id;
    return;
  end if;

  -- Self-referral: affiliate is the referred user, or the other party on the trip.
  if aff.user_id is not null and (aff.user_id = p_user or aff.user_id = counterparty) then
    update public.affiliate_attributions set status = 'rejected', reject_reason = 'self_referral', qualifying_trip_id = p_trip.id where id = att.id;
    return;
  end if;

  select nullif(right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10), '') into v_phone from public.profiles where id = p_user;
  if v_phone is not null and v_phone = nullif(right(regexp_replace(coalesce(aff.phone, ''), '\D', '', 'g'), 10), '') then
    update public.affiliate_attributions set status = 'rejected', reject_reason = 'self_referral', qualifying_trip_id = p_trip.id where id = att.id;
    return;
  end if;

  -- Dedupe: one qualified referral per device / phone / payment fingerprint, program-wide.
  select exists (
    select 1 from public.affiliate_attributions o
    where o.id <> att.id and o.status = 'qualified' and (
      (att.device_hash is not null and o.device_hash = att.device_hash)
      or (v_phone is not null and o.phone_norm = v_phone)
      or (att.payment_fingerprint is not null and o.payment_fingerprint = att.payment_fingerprint)
    )
  ) into dup;
  if dup then
    update public.affiliate_attributions set status = 'rejected', reject_reason = 'duplicate_device_phone_or_payment', phone_norm = v_phone, qualifying_trip_id = p_trip.id where id = att.id;
    return;
  end if;

  update public.affiliate_attributions
    set status = 'qualified', qualified_at = now(), qualifying_trip_id = p_trip.id, phone_norm = v_phone
    where id = att.id;

  if aff.status <> 'active' then return; end if; -- paused/rejected affiliates earn nothing

  select value into rates from public.affiliate_config where key = 'rates';
  amount := round(
    coalesce((rates->>case when p_role = 'driver' then 'driver_first_trip_cents' else 'rider_first_ride_cents' end)::numeric, 0)
    * coalesce((rates->'partner_type_bps'->>aff.partner_type)::numeric, 10000) / 10000
  );
  cap := coalesce((rates->>'monthly_cap')::int, 0);
  if cap > 0 then
    select count(*) into month_count from public.affiliate_ledger
      where affiliate_id = aff.id and kind in ('referral_rider','referral_driver') and amount_cents > 0
        and created_at >= date_trunc('month', now() at time zone 'America/New_York') at time zone 'America/New_York';
    if month_count >= cap then amount := 0; end if;
  end if;

  insert into public.affiliate_ledger (affiliate_id, attribution_id, kind, amount_cents, status, note)
  values (aff.id, att.id, case when p_role = 'driver' then 'referral_driver' else 'referral_rider' end,
          amount, case when amount > 0 then 'pending' else 'void' end,
          case when amount = 0 then 'monthly cap reached or zero rate' end)
  on conflict (attribution_id) do nothing;
end;
$$;

create or replace function public.affiliate_on_trip_completed()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    begin
      perform public.affiliate_qualify_one(new, new.rider_id, 'rider');
      perform public.affiliate_qualify_one(new, new.driver_id, 'driver');
    exception when others then
      raise warning 'affiliate qualify failed for trip %: %', new.id, sqlerrm;
    end;
  end if;
  return null;
end;
$$;

drop trigger if exists trips_affiliate_qualify on public.trips;
create trigger trips_affiliate_qualify after update of status on public.trips
  for each row execute function public.affiliate_on_trip_completed();

revoke all on function public.affiliate_is_e2e_user(uuid) from public, anon, authenticated;
revoke all on function public.affiliate_qualify_one(public.trips, uuid, text) from public, anon, authenticated;
revoke all on function public.affiliate_on_trip_completed() from public, anon, authenticated;
