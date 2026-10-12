-- Driver perks: admin-editable config and a bonus ledger. Additive only.

create table if not exists public.driver_perk_config (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.driver_perk_config enable row level security;
drop policy if exists driver_perk_config_read on public.driver_perk_config;
create policy driver_perk_config_read on public.driver_perk_config
  for select to authenticated using (true);
drop policy if exists driver_perk_config_admin_write on public.driver_perk_config;
create policy driver_perk_config_admin_write on public.driver_perk_config
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.driver_perk_config from public, anon;
grant select, insert, update on public.driver_perk_config to authenticated;
grant all on public.driver_perk_config to service_role;

-- One row per earned bonus. (kind, driver_id, ref) makes awarding idempotent.
create table if not exists public.driver_bonus_ledger (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null,
  kind text not null,
  ref text not null,
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'void')),
  trip_id uuid,
  attempts integer not null default 0,
  last_error text,
  stripe_transfer_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  unique (kind, driver_id, ref)
);
create index if not exists driver_bonus_ledger_pending on public.driver_bonus_ledger (status, created_at) where status in ('pending', 'failed');
alter table public.driver_bonus_ledger enable row level security;
drop policy if exists driver_bonus_ledger_own_select on public.driver_bonus_ledger;
create policy driver_bonus_ledger_own_select on public.driver_bonus_ledger
  for select to authenticated using (driver_id = auth.uid() or public.is_admin());
revoke all on public.driver_bonus_ledger from public, anon;
grant select on public.driver_bonus_ledger to authenticated;
grant all on public.driver_bonus_ledger to service_role;

-- Streaks start counting for bonuses from the moment this ships.
insert into public.driver_perk_config (key, value)
values ('streaks', jsonb_build_object(
  'enabled', true,
  'startsAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'trips', jsonb_build_object('enabled', true, 'target', 10, 'bonusCents', 1000),
  'days', jsonb_build_object('enabled', true, 'target', 5, 'bonusCents', 1500)))
on conflict (key) do nothing;
