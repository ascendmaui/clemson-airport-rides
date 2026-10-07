-- NOT APPLIED. Backup-driver queue for scheduled rides.
-- Staging can exercise the queue through trips.metadata.backup_queue before
-- this file is applied. Do not run it against production from this change.
-- pg_cron and pg_net are already installed. The bearer is vault secret
-- clemson_cron_secret, which must equal CRON_SECRET. One-minute tick.
-- Do not also schedule this on the VPS.

create extension if not exists pg_cron;
create extension if not exists pg_net;

alter table public.trips add column if not exists backup_enabled boolean not null default false;
alter table public.trips add column if not exists backup_bonus_cents integer;
alter table public.trips add column if not exists backup_driver_id uuid;
alter table public.trips add column if not exists confirm_state text not null default 'idle';
alter table public.trips add column if not exists confirm_window_opens_at timestamptz;
alter table public.trips add column if not exists confirm_window_closes_at timestamptz;
alter table public.trips add column if not exists confirm_confirmed_at timestamptz;

alter table public.trips drop constraint if exists trips_backup_bonus_presets;
alter table public.trips add constraint trips_backup_bonus_presets
  check (backup_bonus_cents is null or backup_bonus_cents in (1000, 1500));

alter table public.trips drop constraint if exists trips_confirm_state_known;
alter table public.trips add constraint trips_confirm_state_known
  check (confirm_state in ('idle', 'window_open', 'enroute', 'handed_to_pool'));

create index if not exists trips_backup_slot_open_idx
  on public.trips (pickup_at)
  where backup_enabled = true
    and status = 'scheduled'::public.trip_status
    and backup_driver_id is null;

comment on column public.trips.backup_driver_id is
  'Second driver in the two-deep scheduled queue. The primary remains trips.driver_id after they start toward pickup.';
comment on column public.trips.confirm_state is
  'Confirm window for the assigned driver. idle, window_open, enroute, or handed_to_pool.';

-- Drivers can still see a scheduled ride that already has a primary while the
-- backup seat is open. The previous policy hid every row once driver_id was set.
drop policy if exists trips_driver_scheduled_select on public.trips;
create policy trips_driver_scheduled_select
on public.trips
for select
to authenticated
using (
  status = 'scheduled'::public.trip_status
  and public.is_driver_or_admin_role()
  and (
    driver_id is null
    or (
      backup_enabled = true
      and backup_driver_id is null
      and driver_id is distinct from auth.uid()
    )
    or driver_id = auth.uid()
    or backup_driver_id = auth.uid()
  )
);

create table if not exists public.driver_reliability_strikes (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null,
  trip_id uuid,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists driver_reliability_strikes_driver_idx
  on public.driver_reliability_strikes (driver_id, created_at desc);

alter table public.driver_reliability_strikes enable row level security;

drop policy if exists driver_reliability_strikes_admin_read on public.driver_reliability_strikes;
create policy driver_reliability_strikes_admin_read
on public.driver_reliability_strikes
for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'::public.user_role
  )
);

create table if not exists public.backup_driver_payouts (
  trip_id uuid not null,
  driver_id uuid not null,
  role text not null,
  amount_cents integer not null,
  status text not null,
  attempts integer not null default 0,
  last_error text,
  stripe_transfer_id text,
  updated_at timestamptz not null default now(),
  primary key (trip_id, role)
);

alter table public.backup_driver_payouts enable row level security;

drop policy if exists backup_driver_payouts_driver_read on public.backup_driver_payouts;
create policy backup_driver_payouts_driver_read
on public.backup_driver_payouts
for select
to authenticated
using (driver_id = auth.uid());

create schema if not exists private;
revoke all on schema private from public;

create or replace function private.trigger_scheduled_dispatch_tick()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_request_id bigint;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'clemson_cron_secret'
  limit 1;

  if v_secret is null or length(trim(v_secret)) = 0 then
    raise warning 'scheduled-dispatch-tick: vault secret clemson_cron_secret missing; skipped';
    return null;
  end if;

  select net.http_get(
    url := 'https://clemsonrides.com/api/scheduled-dispatch-tick',
    headers := jsonb_build_object('Authorization', 'Bearer ' || trim(v_secret)),
    timeout_milliseconds := 60000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function private.trigger_scheduled_dispatch_tick() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function private.trigger_scheduled_dispatch_tick() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function private.trigger_scheduled_dispatch_tick() from authenticated;
  end if;
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'scheduled-dispatch-tick') then
    perform cron.unschedule('scheduled-dispatch-tick');
  end if;
end $$;

select cron.schedule(
  'scheduled-dispatch-tick',
  '* * * * *',
  $$select private.trigger_scheduled_dispatch_tick();$$
);
