-- Driver flow slice 2: "Riley tipped you $3" push to the driver.
--
-- When a completed trip's tip_cents goes up (any tip path: saved-card tip,
-- post-ride checkout, or the Stripe webhook), queue one driver_tipped notice
-- in the existing trip_status_notices outbox and poke the drain. The drain
-- (server/tripStatusNotices.js) sends it only to driver builds that registered
-- the trip_status_v1 push feature. One notice per trip and driver.
-- Never blocks the tip write: failures only raise a warning.
--
-- Down (reversible):
--   drop trigger if exists trips_tip_notice on public.trips;
--   drop function if exists public.enqueue_trip_tip_notice();

create or replace function public.enqueue_trip_tip_notice()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
begin
  if NEW.driver_id is null or NEW.status::text <> 'completed'
     or coalesce(NEW.tip_cents, 0) <= coalesce(OLD.tip_cents, 0) then
    return NEW;
  end if;
  begin
    insert into public.trip_status_notices (trip_id, kind, recipient_id, recipient_role, driver_id, dedupe_key)
    values (NEW.id, 'driver_tipped', NEW.driver_id, 'driver', NEW.driver_id, 'driver_tipped:' || NEW.id || ':' || NEW.driver_id)
    on conflict (dedupe_key) do nothing;
    get diagnostics v_count = row_count;
    if v_count > 0 then
      perform private.dispatch_trip_status_notices();
    end if;
  exception when others then
    raise warning 'trip-tip-notice: enqueue skipped for trip %: %', NEW.id, sqlerrm;
  end;
  return NEW;
end;
$$;

revoke all on function public.enqueue_trip_tip_notice() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.enqueue_trip_tip_notice() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.enqueue_trip_tip_notice() from authenticated;
  end if;
end $$;

drop trigger if exists trips_tip_notice on public.trips;
create trigger trips_tip_notice
after update of tip_cents on public.trips
for each row
when (coalesce(new.tip_cents, 0) > coalesce(old.tip_cents, 0))
execute function public.enqueue_trip_tip_notice();
