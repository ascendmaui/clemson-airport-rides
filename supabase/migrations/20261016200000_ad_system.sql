-- In-car tablet ad system. Additive and idempotent.
-- Writes: admins (public.is_admin()) and the service role only.
-- Reads: admins; a signed-in partner reads their own partner row, campaigns, creatives and impressions.
-- The tablet player and partner sign-up go through /api/ads with the service role.

create table if not exists public.ad_partners (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  business_name text not null check (char_length(business_name) between 2 and 120),
  contact_name text not null check (char_length(contact_name) between 2 and 120),
  email text not null check (char_length(email) between 3 and 254 and email like '%@%'),
  phone text check (phone is null or char_length(phone) <= 32),
  category text check (category is null or char_length(category) <= 80),
  website text check (website is null or char_length(website) <= 300),
  logo_url text check (logo_url is null or char_length(logo_url) <= 600),
  stripe_customer_id text,
  status text not null default 'pending' check (status in ('pending', 'active', 'suspended')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ad_partners_profile_idx on public.ad_partners (profile_id);
create index if not exists ad_partners_email_idx on public.ad_partners (lower(email));

create table if not exists public.ad_packages (
  id text primary key check (id ~ '^[a-z0-9-]{2,60}$'),
  name text not null,
  description text,
  price_cents integer not null default 0 check (price_cents >= 0),
  currency text not null default 'usd',
  slot_seconds integer not null default 10 check (slot_seconds between 3 and 120),
  frequency integer not null default 1 check (frequency between 1 and 20),
  placement text not null default 'standard' check (placement in ('standard', 'first_in_loop', 'takeover')),
  duration_days integer not null default 30 check (duration_days between 1 and 366),
  rides_included integer check (rides_included is null or rides_included > 0),
  game_day_boost numeric(4,2) not null default 1 check (game_day_boost between 1 and 10),
  active boolean not null default false,
  placeholder boolean not null default true,
  sort integer not null default 0,
  stripe_product_id text,
  stripe_price_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.ad_partners(id) on delete cascade,
  package_id text references public.ad_packages(id) on delete set null,
  name text,
  status text not null default 'draft' check (status in ('draft', 'pending_payment', 'active', 'paused', 'ended')),
  starts_at timestamptz,
  ends_at timestamptz,
  rides_purchased integer check (rides_purchased is null or rides_purchased > 0),
  rides_served integer not null default 0 check (rides_served >= 0),
  price_cents integer check (price_cents is null or price_cents >= 0),
  stripe_invoice_id text,
  stripe_checkout_session_id text,
  payment_url text,
  paid_at timestamptz,
  ended_reason text,
  last_reminder_at timestamptz,
  ending_notice_at timestamptz,
  last_report_month text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index if not exists ad_campaigns_partner_idx on public.ad_campaigns (partner_id);
create index if not exists ad_campaigns_status_idx on public.ad_campaigns (status);

create table if not exists public.ad_creatives (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  kind text not null check (kind in ('image', 'video', 'built')),
  storage_path text,
  media_url text,
  headline text check (headline is null or char_length(headline) <= 80),
  deal_text text check (deal_text is null or char_length(deal_text) <= 160),
  qr_url text check (qr_url is null or char_length(qr_url) <= 500),
  logo_url text check (logo_url is null or char_length(logo_url) <= 600),
  theme text not null default 'purple' check (theme in ('purple', 'orange', 'light')),
  approval_status text not null default 'pending_review' check (approval_status in ('pending_review', 'approved', 'rejected')),
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind = 'built' or media_url is not null or storage_path is not null)
);
create index if not exists ad_creatives_campaign_idx on public.ad_creatives (campaign_id);

create table if not exists public.ad_devices (
  id uuid primary key default gen_random_uuid(),
  label text not null check (char_length(label) between 1 and 80),
  token_hash text not null unique,
  driver_id uuid references public.profiles(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  active boolean not null default true,
  demo boolean not null default false,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.ad_impressions (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  creative_id uuid references public.ad_creatives(id) on delete set null,
  device_id uuid references public.ad_devices(id) on delete set null,
  driver_id uuid,
  vehicle_id uuid,
  trip_id uuid,
  shown_at timestamptz not null default now(),
  seconds_shown numeric(6,2) not null default 0 check (seconds_shown >= 0 and seconds_shown <= 600),
  client_id text,
  unique (device_id, client_id)
);
create index if not exists ad_impressions_campaign_idx on public.ad_impressions (campaign_id, shown_at desc);

create table if not exists public.ad_ride_counts (
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  trip_id uuid not null,
  device_id uuid references public.ad_devices(id) on delete set null,
  counted_at timestamptz not null default now(),
  primary key (campaign_id, trip_id)
);

-- One 'ride served' per campaign per trip. Ends the campaign when the purchased rides are used.
create or replace function public.ad_count_ride(p_campaign uuid, p_trip uuid, p_device uuid default null)
returns table (counted boolean, rides_served integer, status text)
language plpgsql security definer set search_path = public as $$
declare
  inserted integer;
  c public.ad_campaigns%rowtype;
begin
  insert into public.ad_ride_counts (campaign_id, trip_id, device_id)
    values (p_campaign, p_trip, p_device) on conflict do nothing;
  get diagnostics inserted = row_count;
  if inserted = 1 then
    update public.ad_campaigns set rides_served = ad_campaigns.rides_served + 1, updated_at = now()
      where id = p_campaign returning * into c;
    if c.rides_purchased is not null and c.rides_served >= c.rides_purchased and c.status = 'active' then
      update public.ad_campaigns set status = 'ended', ended_reason = 'rides_reached', updated_at = now()
        where id = p_campaign returning * into c;
    end if;
  else
    select * into c from public.ad_campaigns where id = p_campaign;
  end if;
  return query select inserted = 1, c.rides_served, c.status;
end $$;
revoke all on function public.ad_count_ride(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.ad_count_ride(uuid, uuid, uuid) to service_role;

create or replace function public.ad_partner_ids_for(p_uid uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from public.ad_partners where profile_id = p_uid
$$;
revoke all on function public.ad_partner_ids_for(uuid) from public, anon;
grant execute on function public.ad_partner_ids_for(uuid) to authenticated, service_role;

alter table public.ad_partners enable row level security;
alter table public.ad_packages enable row level security;
alter table public.ad_campaigns enable row level security;
alter table public.ad_creatives enable row level security;
alter table public.ad_devices enable row level security;
alter table public.ad_impressions enable row level security;
alter table public.ad_ride_counts enable row level security;

revoke all on public.ad_partners, public.ad_packages, public.ad_campaigns, public.ad_creatives,
  public.ad_devices, public.ad_impressions, public.ad_ride_counts from anon, authenticated;
grant select, insert, update, delete on public.ad_partners, public.ad_packages, public.ad_campaigns,
  public.ad_creatives, public.ad_devices, public.ad_impressions, public.ad_ride_counts to authenticated;
grant select on public.ad_packages to anon;
grant all on public.ad_partners, public.ad_packages, public.ad_campaigns, public.ad_creatives,
  public.ad_devices, public.ad_impressions, public.ad_ride_counts to service_role;

do $$
declare t text;
begin
  foreach t in array array['ad_partners','ad_packages','ad_campaigns','ad_creatives','ad_devices','ad_impressions','ad_ride_counts'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_admin_all', t);
  end loop;
end $$;

drop policy if exists ad_packages_public_read on public.ad_packages;
create policy ad_packages_public_read on public.ad_packages for select to anon, authenticated
  using (active and not placeholder);

drop policy if exists ad_partners_own_read on public.ad_partners;
create policy ad_partners_own_read on public.ad_partners for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists ad_campaigns_own_read on public.ad_campaigns;
create policy ad_campaigns_own_read on public.ad_campaigns for select to authenticated
  using (partner_id in (select public.ad_partner_ids_for(auth.uid())));

drop policy if exists ad_creatives_own_read on public.ad_creatives;
create policy ad_creatives_own_read on public.ad_creatives for select to authenticated
  using (campaign_id in (select id from public.ad_campaigns where partner_id in (select public.ad_partner_ids_for(auth.uid()))));

drop policy if exists ad_impressions_own_read on public.ad_impressions;
create policy ad_impressions_own_read on public.ad_impressions for select to authenticated
  using (campaign_id in (select id from public.ad_campaigns where partner_id in (select public.ad_partner_ids_for(auth.uid()))));

-- PLACEHOLDER packages: inactive and marked placeholder until John approves real tiers.
insert into public.ad_packages (id, name, description, price_cents, slot_seconds, frequency, placement, duration_days, rides_included, game_day_boost, active, placeholder, sort)
values
  ('placeholder-local', 'PLACEHOLDER Local', 'PLACEHOLDER: not approved', 0, 10, 1, 'standard', 30, 500, 1, false, true, 10),
  ('placeholder-featured', 'PLACEHOLDER Featured', 'PLACEHOLDER: not approved', 0, 15, 2, 'first_in_loop', 30, 1000, 1.5, false, true, 20),
  ('placeholder-game-day', 'PLACEHOLDER Game Day', 'PLACEHOLDER: not approved', 0, 15, 3, 'takeover', 3, null, 3, false, true, 30)
on conflict (id) do nothing;

-- Creative uploads. Public read so tablets can play and cache them; writes go through signed upload URLs.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('ad-creatives', 'ad-creatives', true, 52428800,
      array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime'])
    on conflict (id) do nothing;
  end if;
end $$;

comment on table public.ad_campaigns is 'In-car tablet ad campaigns. Status draft -> pending_payment -> active -> paused/ended.';
