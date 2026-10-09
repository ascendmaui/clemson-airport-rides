-- Cancel and no-show notices for both sides, on the trip_status_notices outbox.
--   rider cancels or switches away (accepted/arriving/arrived) -> driver: rider_canceled
--   rider ends a trip early (canceled_midride)                 -> driver: rider_ended_early
--   wait cancel / no-show (cancelled_wait)                      -> driver: rider_no_show, rider: wait_canceled
--   driver cancels before pickup (back to searching)            -> rider: driver_canceled
-- Pushes to drivers still only go to builds that registered the trip_status_v1 feature.
-- Same trigger (trips_status_notices); this only replaces the function body.

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
  v_old text := OLD.status::text;
  v_driver uuid := NEW.driver_id;
  v_prev uuid := OLD.driver_id;
  v_pickup timestamptz := coalesce(NEW.pickup_at, NEW.scheduled_for);
  v_switched boolean := false;
begin
  if NEW.rider_id is null or coalesce(v_driver, v_prev) is null then
    return NEW;
  end if;
  begin
    v_switched := (to_jsonb(NEW) -> 'metadata' -> 'rider_switch') is distinct from (to_jsonb(OLD) -> 'metadata' -> 'rider_switch');
    if v_status = 'accepted' and v_driver is not null then
      -- A scheduled ride accepted well ahead of pickup is not "on the way" yet.
      if v_pickup is null or v_pickup <= now() + interval '45 minutes' then
        insert into public.trip_status_notices (trip_id, kind, recipient_id, recipient_role, driver_id, dedupe_key)
        values (NEW.id, 'driver_en_route', NEW.rider_id, 'rider', v_driver, 'driver_en_route:' || NEW.id || ':' || v_driver)
        on conflict (dedupe_key) do nothing;
        get diagnostics v_count = row_count;
        v_queued := v_queued + v_count;
      end if;
    elsif v_status = 'arriving' and v_driver is not null then
      insert into public.trip_status_notices (trip_id, kind, recipient_id, recipient_role, driver_id, dedupe_key)
      values
        (NEW.id, 'driver_arriving', NEW.rider_id, 'rider', v_driver, 'driver_arriving:' || NEW.id || ':' || v_driver),
        (NEW.id, 'arrive_prompt', v_driver, 'driver', v_driver, 'arrive_prompt:' || NEW.id || ':' || v_driver)
      on conflict (dedupe_key) do nothing;
      get diagnostics v_count = row_count;
      v_queued := v_queued + v_count;
    elsif v_status = 'arrived' and v_driver is not null then
      insert into public.trip_status_notices (trip_id, kind, recipient_id, recipient_role, driver_id, dedupe_key)
      values (NEW.id, 'driver_arrived', NEW.rider_id, 'rider', v_driver, 'driver_arrived:' || NEW.id || ':' || v_driver)
      on conflict (dedupe_key) do nothing;
      get diagnostics v_count = row_count;
      v_queued := v_queued + v_count;
    elsif v_status = 'canceled' and v_old in ('accepted', 'arriving', 'arrived') and v_prev is not null then
      insert into public.trip_status_notices (trip_id, kind, recipient_id, recipient_role, driver_id, dedupe_key)
      values (NEW.id, 'rider_canceled', v_prev, 'driver', v_prev, 'rider_canceled:' || NEW.id || ':' || v_prev)
      on conflict (dedupe_key) do nothing;
      get diagnostics v_count = row_count;
      v_queued := v_queued + v_count;
    elsif v_status = 'searching' and v_old in ('accepted', 'arriving', 'arrived') and v_prev is not null and v_driver is null then
      if v_switched then
        -- Rider changed driver, ride type, or carpool: the old driver is released.
        insert into public.trip_status_notices (trip_id, kind, recipient_id, recipient_role, driver_id, dedupe_key)
        values (NEW.id, 'rider_canceled', v_prev, 'driver', v_prev, 'rider_canceled:' || NEW.id || ':' || v_prev)
        on conflict (dedupe_key) do nothing;
      else
        insert into public.trip_status_notices (trip_id, kind, recipient_id, recipient_role, driver_id, dedupe_key)
        values (NEW.id, 'driver_canceled', NEW.rider_id, 'rider', v_prev, 'driver_canceled:' || NEW.id || ':' || v_prev)
        on conflict (dedupe_key) do nothing;
      end if;
      get diagnostics v_count = row_count;
      v_queued := v_queued + v_count;
    elsif v_status = 'canceled_midride' and coalesce(v_driver, v_prev) is not null then
      insert into public.trip_status_notices (trip_id, kind, recipient_id, recipient_role, driver_id, dedupe_key)
      values (NEW.id, 'rider_ended_early', coalesce(v_driver, v_prev), 'driver', coalesce(v_driver, v_prev),
        'rider_ended_early:' || NEW.id || ':' || coalesce(v_driver, v_prev))
      on conflict (dedupe_key) do nothing;
      get diagnostics v_count = row_count;
      v_queued := v_queued + v_count;
    elsif v_status = 'cancelled_wait' and coalesce(v_driver, v_prev) is not null then
      insert into public.trip_status_notices (trip_id, kind, recipient_id, recipient_role, driver_id, dedupe_key)
      values
        (NEW.id, 'rider_no_show', coalesce(v_driver, v_prev), 'driver', coalesce(v_driver, v_prev),
          'rider_no_show:' || NEW.id || ':' || coalesce(v_driver, v_prev)),
        (NEW.id, 'wait_canceled', NEW.rider_id, 'rider', coalesce(v_driver, v_prev),
          'wait_canceled:' || NEW.id || ':' || coalesce(v_driver, v_prev))
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
