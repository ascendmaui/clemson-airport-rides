-- Affiliate Stripe Connect + live dashboard signals (additive only).
-- Does not drop or rewrite the affiliate program tables from
-- 20261012200000_affiliate_program.sql.

alter table public.affiliates
  add column if not exists stripe_connect_status text not null default 'not_started'
    check (stripe_connect_status in ('not_started','pending','verified','restricted')),
  add column if not exists stripe_details_submitted boolean not null default false,
  add column if not exists stripe_payouts_enabled boolean not null default false,
  add column if not exists stripe_charges_enabled boolean not null default false,
  add column if not exists stripe_disabled_reason text,
  add column if not exists stripe_onboarded_at timestamptz;

update public.affiliates
  set stripe_connect_status = 'pending'
  where stripe_account_id is not null
    and stripe_connect_status = 'not_started';

alter table public.affiliate_attributions
  add column if not exists masked_name text;

create table if not exists public.affiliate_payout_events (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  ledger_id uuid references public.affiliate_ledger(id) on delete set null,
  stripe_event_id text unique,
  event_type text not null,
  stripe_object_id text,
  amount_cents integer,
  currency text,
  status text,
  created_at timestamptz not null default now()
);
create index if not exists affiliate_payout_events_affiliate_idx
  on public.affiliate_payout_events (affiliate_id, created_at desc);

-- One row per affiliate. Bumped when their dashboard data changes so the
-- client can refetch through the API (which masks names) instead of
-- subscribing to clicks or attributions, which hold device and payment hashes.
create table if not exists public.affiliate_dashboard_signals (
  affiliate_id uuid primary key references public.affiliates(id) on delete cascade,
  updated_at timestamptz not null default now()
);

alter table public.affiliate_payout_events enable row level security;
alter table public.affiliate_dashboard_signals enable row level security;

drop policy if exists affiliate_payout_events_select_own on public.affiliate_payout_events;
create policy affiliate_payout_events_select_own on public.affiliate_payout_events
  for select to authenticated
  using (exists (
    select 1 from public.affiliates a
    where a.id = affiliate_payout_events.affiliate_id
      and a.user_id = (select auth.uid())
  ));

drop policy if exists affiliate_signals_select_own on public.affiliate_dashboard_signals;
create policy affiliate_signals_select_own on public.affiliate_dashboard_signals
  for select to authenticated
  using (exists (
    select 1 from public.affiliates a
    where a.id = affiliate_dashboard_signals.affiliate_id
      and a.user_id = (select auth.uid())
  ));

-- Attributions stay readable only as the masked columns. Device hashes,
-- phones, payment fingerprints, and the referred user id are not granted.
revoke all on public.affiliate_attributions from authenticated;
grant select (id, affiliate_id, role, status, qualified_at, created_at, masked_name)
  on public.affiliate_attributions to authenticated;

drop policy if exists affiliate_attributions_select_own on public.affiliate_attributions;
create policy affiliate_attributions_select_own on public.affiliate_attributions
  for select to authenticated
  using (exists (
    select 1 from public.affiliates a
    where a.id = affiliate_attributions.affiliate_id
      and a.user_id = (select auth.uid())
  ));

-- Own-row policies subquery affiliates. Supabase default privileges usually
-- grant this already; say it here so a fresh database matches production.
grant select on public.affiliates, public.affiliate_ledger to authenticated;
grant select on public.affiliate_payout_events, public.affiliate_dashboard_signals to authenticated;
revoke insert, update, delete on public.affiliate_payout_events, public.affiliate_dashboard_signals from anon, authenticated;
revoke all on public.affiliate_payout_events, public.affiliate_dashboard_signals from anon;
revoke insert, update, delete on public.affiliate_attributions from anon, authenticated;

-- Clicks are counts only. Affiliates may read their own rows; writes stay on the API.
grant select on public.affiliate_clicks to authenticated;
revoke insert, update, delete on public.affiliate_clicks from anon, authenticated;

drop policy if exists affiliate_clicks_select_own on public.affiliate_clicks;
create policy affiliate_clicks_select_own on public.affiliate_clicks
  for select to authenticated
  using (exists (
    select 1 from public.affiliates a
    where a.id = affiliate_clicks.affiliate_id
      and a.user_id = (select auth.uid())
  ));

create or replace function public.affiliate_touch_signal()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  aid uuid;
begin
  begin
    if tg_table_name = 'affiliates' then
      aid := coalesce(new.id, old.id);
    else
      aid := coalesce(new.affiliate_id, old.affiliate_id);
    end if;
    if aid is null then return null; end if;
    insert into public.affiliate_dashboard_signals (affiliate_id, updated_at)
      values (aid, now())
      on conflict (affiliate_id) do update set updated_at = now();
  exception when others then
    raise warning 'affiliate signal failed: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists affiliate_signal_affiliates on public.affiliates;
create trigger affiliate_signal_affiliates
  after insert or update on public.affiliates
  for each row execute function public.affiliate_touch_signal();

drop trigger if exists affiliate_signal_clicks on public.affiliate_clicks;
create trigger affiliate_signal_clicks
  after insert or delete on public.affiliate_clicks
  for each row execute function public.affiliate_touch_signal();

drop trigger if exists affiliate_signal_attributions on public.affiliate_attributions;
create trigger affiliate_signal_attributions
  after insert or update or delete on public.affiliate_attributions
  for each row execute function public.affiliate_touch_signal();

drop trigger if exists affiliate_signal_ledger on public.affiliate_ledger;
create trigger affiliate_signal_ledger
  after insert or update or delete on public.affiliate_ledger
  for each row execute function public.affiliate_touch_signal();

drop trigger if exists affiliate_signal_payouts on public.affiliate_payout_events;
create trigger affiliate_signal_payouts
  after insert or update on public.affiliate_payout_events
  for each row execute function public.affiliate_touch_signal();

revoke all on function public.affiliate_touch_signal() from public, anon, authenticated;

insert into public.affiliate_dashboard_signals (affiliate_id)
select id from public.affiliates
on conflict (affiliate_id) do nothing;

alter table public.affiliates replica identity full;
alter table public.affiliate_ledger replica identity full;
alter table public.affiliate_payout_events replica identity full;
alter table public.affiliate_dashboard_signals replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'affiliates'
    ) then
      alter publication supabase_realtime add table public.affiliates;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'affiliate_ledger'
    ) then
      alter publication supabase_realtime add table public.affiliate_ledger;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'affiliate_payout_events'
    ) then
      alter publication supabase_realtime add table public.affiliate_payout_events;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'affiliate_dashboard_signals'
    ) then
      alter publication supabase_realtime add table public.affiliate_dashboard_signals;
    end if;
  end if;
end $$;
