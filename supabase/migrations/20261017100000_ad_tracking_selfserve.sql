-- In-car tablet ads, part 2: pay-per-ride bundles, QR scan tracking, partner analytics,
-- self-serve campaigns, boosts, targeting and founding-partner applications.
-- Additive and idempotent. Writes go through /api/ads with the service role; admins (is_admin())
-- can do anything; a signed-in partner reads only rows for their own campaigns.

-- Packages: ride bundles and add-ons.
alter table public.ad_packages add column if not exists kind text not null default 'package';
do $$ begin
  alter table public.ad_packages add constraint ad_packages_kind_check check (kind in ('package', 'bundle', 'addon'));
exception when duplicate_object then null; end $$;

-- DRAFT ride bundles (pending John's approval): placeholder = true keeps them out of billing
-- and the public package policy. Prices mirror src/content/adPackages.js.
insert into public.ad_packages (id, kind, name, description, price_cents, slot_seconds, frequency, placement, duration_days, rides_included, game_day_boost, active, placeholder, sort)
values
  ('rides-100', 'bundle', '100 rides', 'DRAFT pending approval: ad shown in 100 rides', 1200, 10, 1, 'standard', 120, 100, 1, false, true, 100),
  ('rides-250', 'bundle', '250 rides', 'DRAFT pending approval: ad shown in 250 rides', 2500, 10, 1, 'standard', 120, 250, 1, false, true, 110),
  ('rides-1000', 'bundle', '1,000 rides', 'DRAFT pending approval: ad shown in 1,000 rides', 8900, 10, 1, 'standard', 120, 1000, 1, false, true, 120),
  ('rides-5000', 'bundle', '5,000 rides', 'DRAFT pending approval: ad shown in 5,000 rides', 29900, 10, 1, 'standard', 120, 5000, 1, false, true, 130),
  ('game-day-weekend', 'addon', 'Game-day weekend boost', 'DRAFT pending approval: extra weight on home game weekends', 0, 10, 1, 'standard', 3, null, 2, false, true, 200)
on conflict (id) do update set
  kind = excluded.kind, name = excluded.name, description = excluded.description,
  price_cents = excluded.price_cents, rides_included = excluded.rides_included, updated_at = now()
  where public.ad_packages.placeholder;

-- Partners: address and map pin for radius targeting, founding approval, auto-approve toggle.
alter table public.ad_partners add column if not exists address text;
alter table public.ad_partners add column if not exists lat double precision;
alter table public.ad_partners add column if not exists lng double precision;
alter table public.ad_partners add column if not exists founding_approved boolean not null default false;
alter table public.ad_partners add column if not exists auto_approve_creatives boolean not null default false;

-- Campaigns: targeting, deal destination, game-day boost, launch time.
alter table public.ad_campaigns add column if not exists targeting jsonb not null default '{"radius_mi": 0, "routes": ["all"]}'::jsonb;
alter table public.ad_campaigns add column if not exists destination_url text;
alter table public.ad_campaigns add column if not exists game_day_boost boolean not null default false;
alter table public.ad_campaigns add column if not exists launched_at timestamptz;
do $$ begin
  alter table public.ad_campaigns add constraint ad_campaigns_destination_len check (destination_url is null or char_length(destination_url) <= 500);
exception when duplicate_object then null; end $$;

-- Impressions: partner, visibility, and the QR token that was on screen.
alter table public.ad_impressions add column if not exists partner_id uuid;
alter table public.ad_impressions add column if not exists visible boolean not null default false;
alter table public.ad_impressions add column if not exists qr_token text;
create index if not exists ad_impressions_trip_idx on public.ad_impressions (campaign_id, trip_id);

-- Tracking QR codes: one short token per device + creative + ride. /q/<token> logs and redirects.
create table if not exists public.ad_qr_tokens (
  token text primary key check (token ~ '^[A-Za-z0-9_-]{8,40}$'),
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  creative_id uuid references public.ad_creatives(id) on delete set null,
  partner_id uuid references public.ad_partners(id) on delete cascade,
  device_id uuid references public.ad_devices(id) on delete set null,
  trip_id uuid,
  destination_url text not null check (char_length(destination_url) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists ad_qr_tokens_campaign_idx on public.ad_qr_tokens (campaign_id);

-- QR scans. No personal data: a truncated user agent and a salted daily hash for de-duplication.
create table if not exists public.ad_qr_scans (
  id bigint generated always as identity primary key,
  token text not null references public.ad_qr_tokens(token) on delete cascade,
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  creative_id uuid,
  partner_id uuid,
  device_id uuid,
  trip_id uuid,
  scanned_at timestamptz not null default now(),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  visitor_hash text check (visitor_hash is null or char_length(visitor_hash) <= 64),
  duplicate boolean not null default false
);
create index if not exists ad_qr_scans_campaign_idx on public.ad_qr_scans (campaign_id, scanned_at desc);
create index if not exists ad_qr_scans_dedupe_idx on public.ad_qr_scans (token, visitor_hash, scanned_at desc);

-- Boosts: double the remaining rides at the campaign's per-ride rate. Billing stays off by flag.
create table if not exists public.ad_campaign_boosts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  partner_id uuid not null references public.ad_partners(id) on delete cascade,
  rides_added integer not null check (rides_added > 0),
  per_ride_cents numeric(10,4) not null check (per_ride_cents >= 0),
  price_cents integer not null check (price_cents >= 0),
  status text not null default 'pending_payment' check (status in ('pending_payment', 'paid', 'applied', 'canceled')),
  stripe_invoice_id text,
  payment_url text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  applied_at timestamptz
);
create index if not exists ad_campaign_boosts_campaign_idx on public.ad_campaign_boosts (campaign_id);

-- Founding-partner applications (public insert, pending only; John approves in the admin desk).
create table if not exists public.ad_partner_applications (
  id uuid primary key default gen_random_uuid(),
  business_name text not null check (char_length(business_name) between 2 and 120),
  category text check (category is null or char_length(category) <= 80),
  address text not null check (char_length(address) between 5 and 200),
  contact_name text not null check (char_length(contact_name) between 2 and 120),
  email text not null check (char_length(email) between 3 and 254 and email like '%@%'),
  phone text check (phone is null or char_length(phone) <= 32),
  website text check (website is null or char_length(website) <= 300),
  promote text not null check (char_length(promote) between 3 and 500),
  offer text check (offer is null or char_length(offer) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  partner_id uuid references public.ad_partners(id) on delete set null,
  review_note text,
  reviewed_at timestamptz,
  source text not null default 'advertise_apply' check (source = 'advertise_apply'),
  created_at timestamptz not null default now()
);
create index if not exists ad_partner_applications_created_idx on public.ad_partner_applications (created_at desc);

alter table public.ad_qr_tokens enable row level security;
alter table public.ad_qr_scans enable row level security;
alter table public.ad_campaign_boosts enable row level security;
alter table public.ad_partner_applications enable row level security;

revoke all on public.ad_qr_tokens, public.ad_qr_scans, public.ad_campaign_boosts, public.ad_partner_applications from anon, authenticated;
grant select, insert, update, delete on public.ad_qr_tokens, public.ad_qr_scans, public.ad_campaign_boosts, public.ad_partner_applications to authenticated;
grant all on public.ad_qr_tokens, public.ad_qr_scans, public.ad_campaign_boosts, public.ad_partner_applications to service_role;
grant insert (business_name, category, address, contact_name, email, phone, website, promote, offer) on public.ad_partner_applications to anon;

do $$
declare t text;
begin
  foreach t in array array['ad_qr_tokens','ad_qr_scans','ad_campaign_boosts','ad_partner_applications'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t || '_admin_all', t);
  end loop;
end $$;

drop policy if exists ad_partner_applications_public_insert on public.ad_partner_applications;
create policy ad_partner_applications_public_insert on public.ad_partner_applications for insert to anon, authenticated
  with check (status = 'pending' and partner_id is null and reviewed_at is null and review_note is null);

drop policy if exists ad_qr_scans_own_read on public.ad_qr_scans;
create policy ad_qr_scans_own_read on public.ad_qr_scans for select to authenticated
  using (campaign_id in (select id from public.ad_campaigns where partner_id in (select public.ad_partner_ids_for(auth.uid()))));

drop policy if exists ad_campaign_boosts_own_read on public.ad_campaign_boosts;
create policy ad_campaign_boosts_own_read on public.ad_campaign_boosts for select to authenticated
  using (partner_id in (select public.ad_partner_ids_for(auth.uid())));

drop policy if exists ad_ride_counts_own_read on public.ad_ride_counts;
create policy ad_ride_counts_own_read on public.ad_ride_counts for select to authenticated
  using (campaign_id in (select id from public.ad_campaigns where partner_id in (select public.ad_partner_ids_for(auth.uid()))));

comment on table public.ad_qr_scans is 'QR scans from in-car tablet ads (/q/<token>). No PII: truncated user agent and a salted daily visitor hash.';
