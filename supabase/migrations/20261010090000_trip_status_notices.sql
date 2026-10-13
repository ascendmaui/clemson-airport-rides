-- Driver flow slice 1: rider push tokens and a trip status-change notice outbox.
--
-- 1. rider_push_tokens mirrors driver_push_tokens (own-row RLS, service role reads).
-- 2. driver_push_tokens.features lets the server send trip-status pushes only to
--    driver builds that understand them (TestFlight 29/30 never set it).
-- 3. trip_status_notices is a private outbox. An AFTER UPDATE OF status trigger on
--    trips enqueues one row per (kind, trip, driver) and pokes the API through the
--    existing Vault/pg_net cron pattern. The trip-sweeps cron drains anything left.
--    Notice failures never block a trip update.

create table if not exists public.rider_push_tokens (
  rider_id uuid primary key references auth.users(id) on delete cascade,
  token text not null,
  platform text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.rider_push_tokens enable row level security;

drop policy if exists rider_push_tokens_own_select on public.rider_push_tokens;
create policy rider_push_tokens_own_select on public.rider_push_tokens
  for select to authenticated using (rider_id = auth.uid());
drop policy if exists rider_push_tokens_own_insert on public.rider_push_tokens;
create policy rider_push_tokens_own_insert on public.rider_push_tokens
  for insert to authenticated with check (rider_id = auth.uid());
drop policy if exists rider_push_tokens_own_update on public.rider_push_tokens;
create policy rider_push_tokens_own_update on public.rider_push_tokens
  for update to authenticated using (rider_id = auth.uid()) with check (rider_id = auth.uid());
drop policy if exists rider_push_tokens_own_delete on public.rider_push_tokens;
create policy rider_push_tokens_own_delete on public.rider_push_tokens
  for delete to authenticated using (rider_id = auth.uid());

revoke all on public.rider_push_tokens from public, anon;
grant select, insert, update, delete on public.rider_push_tokens to authenticated;
grant all on public.rider_push_tokens to service_role;

alter table public.driver_push_tokens add column if not exists features text[] not null default '{}';

create table if not exists public.trip_status_notices (
  id bigint generated always as identity primary key,
  trip_id uuid not null references public.trips(id) on delete cascade,
  kind text not null,
  recipient_id uuid not null,
  recipient_role text not null check (recipient_role in ('rider', 'driver')),
  driver_id uuid,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at timestamptz,
  result text,
  attempts integer not null default 0
);

create index if not exists trip_status_notices_pending_idx
  on public.trip_status_notices (created_at) where sent_at is null;

alter table public.trip_status_notices enable row level security;
revoke all on public.trip_status_notices from public, anon, authenticated;
grant all on public.trip_status_notices to service_role;

create schema if not exists private;
revoke all on schema private from public;

create or replace function private.dispatch_trip_status_notices()
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
    raise warning 'trip-status-notices: vault secret clemson_cron_secret missing; skipped';
    return null;
  end if;

  select net.http_get(
    url := 'https://clemsonrides.com/api/driver?action=trip-sweeps&only=trip-status-notices',
    headers := jsonb_build_object('Authorization', 'Bearer ' || trim(v_secret)),
    timeout_milliseconds := 30000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function private.dispatch_trip_status_notices() from public;

create or replace function public.enqueue_trip_status_notices()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_queued integer := 0;
  v_count integer;
  v_status text := NEW.status::text;
  v_driver uuid := NEW.driver_id;
  v_pickup timestamptz := coalesce(NEW.pickup_at, NEW.scheduled_for);
begin
  if v_driver is null or NEW.rider_id is null then
    return NEW;
  end if;
  begin
    if v_status = 'accepted' then
      -- A scheduled ride accepted well ahead of pickup is not "on the way" yet.
      if v_pickup is null or v_pickup <= now() + interval '45 minutes' then
        insert into public.trip_status_notices (trip_id, kind, recipient_id, recipient_role, driver_id, dedupe_key)
        values (NEW.id, 'driver_en_route', NEW.rider_id, 'rider', v_driver, 'driver_en_route:' || NEW.id || ':' || v_driver)
        on conflict (dedupe_key) do nothing;
        get diagnostics v_count = row_count;
        v_queued := v_queued + v_count;
      end if;
    elsif v_status = 'arriving' then
      insert into public.trip_status_notices (trip_id, kind, recipient_id, recipient_role, driver_id, dedupe_key)
      values
        (NEW.id, 'driver_arriving', NEW.rider_id, 'rider', v_driver, 'driver_arriving:' || NEW.id || ':' || v_driver),
        (NEW.id, 'arrive_prompt', v_driver, 'driver', v_driver, 'arrive_prompt:' || NEW.id || ':' || v_driver)
      on conflict (dedupe_key) do nothing;
      get diagnostics v_count = row_count;
      v_queued := v_queued + v_count;
    elsif v_status = 'arrived' then
      insert into public.trip_status_notices (trip_id, kind, recipient_id, recipient_role, driver_id, dedupe_key)
      values (NEW.id, 'driver_arrived', NEW.rider_id, 'rider', v_driver, 'driver_arrived:' || NEW.id || ':' || v_driver)
      on conflict (dedupe_key) do nothing;
      get diagnostics v_count = row_count;
      v_queued := v_queued + v_count;
    end if;

    if v_queued > 0 then
      perform private.dispatch_trip_status_notices();
    end if;
  exception when others then
    raise warning 'trip-status-notices: enqueue skipped for trip %: %', NEW.id, sqlerrm;
  end;
  return NEW;
end;
$$;

revoke all on function public.enqueue_trip_status_notices() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.enqueue_trip_status_notices() from anon;
    revoke all on function private.dispatch_trip_status_notices() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.enqueue_trip_status_notices() from authenticated;
    revoke all on function private.dispatch_trip_status_notices() from authenticated;
  end if;
end $$;

drop trigger if exists trips_status_notices on public.trips;
create trigger trips_status_notices
after update of status on public.trips
for each row
when (old.status is distinct from new.status)
execute function public.enqueue_trip_status_notices();

-- Down:
-- drop trigger if exists trips_status_notices on public.trips;
-- drop function if exists public.enqueue_trip_status_notices();
-- drop function if exists private.dispatch_trip_status_notices();
-- drop table if exists public.trip_status_notices;
-- alter table public.driver_push_tokens drop column if exists features;
-- drop table if exists public.rider_push_tokens;
