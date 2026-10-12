-- Per-driver perk preferences (leaderboard opt-out now; later perks add columns). Additive.
create table if not exists public.driver_perk_prefs (
  driver_id uuid primary key,
  leaderboard_opt_out boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.driver_perk_prefs enable row level security;
drop policy if exists driver_perk_prefs_own_select on public.driver_perk_prefs;
create policy driver_perk_prefs_own_select on public.driver_perk_prefs
  for select to authenticated using (driver_id = auth.uid());
drop policy if exists driver_perk_prefs_own_insert on public.driver_perk_prefs;
create policy driver_perk_prefs_own_insert on public.driver_perk_prefs
  for insert to authenticated with check (driver_id = auth.uid());
drop policy if exists driver_perk_prefs_own_update on public.driver_perk_prefs;
create policy driver_perk_prefs_own_update on public.driver_perk_prefs
  for update to authenticated using (driver_id = auth.uid()) with check (driver_id = auth.uid());
revoke all on public.driver_perk_prefs from public, anon;
grant select, insert, update on public.driver_perk_prefs to authenticated;
grant all on public.driver_perk_prefs to service_role;

insert into public.driver_perk_config (key, value)
values ('leaderboard', jsonb_build_object('enabled', true, 'size', 10))
on conflict (key) do nothing;
