-- P0-1: clients (PostgREST role authenticated/anon) can no longer rewrite trip
-- money, payout metadata or arbitrary status. Server code (service_role) and
-- SECURITY DEFINER RPCs (trip_wait_apply, accept_scheduled_trip,
-- sync_pickup_approach, ...) run as another current_user and are not affected.
--
-- Client writes are whitelisted: the row is reset to OLD and only the allowed
-- fields of an allowed transition are copied back. Older app builds (TestFlight 29)
-- that still write status directly keep working for the equivalent transitions:
--   driver claim     searching|offered -> accepted|offered (driver_id := self)
--   driver progress  accepted -> arriving, accepted|arriving -> arrived, arrived -> in_progress
--   rider cancel     scheduled|searching|offered -> canceled, accepted -> canceled (scheduled rides only)
--   decline release  offered -> searching (unassigned)
--   no-op            same status (e.g. the old second "completed" write after settle)
-- Anything else raises trip_transition_not_allowed. Accept-time economics are
-- recomputed here from the offer ladder; client-sent values are ignored.
--
-- Down (reversible):
--   drop trigger if exists trips_aa_guard_client_write on public.trips;
--   drop trigger if exists trips_aa_guard_client_insert on public.trips;
--   drop function if exists public.guard_trip_client_write();
--   drop function if exists public.guard_trip_client_insert();
--   drop policy if exists trips_update_participants on public.trips;
--   create policy trips_update_participants on public.trips for update to public
--     using ((auth.uid() = rider_id) or (auth.uid() = driver_id));

create or replace function public.guard_trip_client_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid;
  v_req public.trips%rowtype;
  v_from text;
  v_to text;
  v_is_driver boolean;
  v_is_rider boolean;
  v_claim boolean;
  v_scheduled boolean;
  v_lock boolean;
  v_phase text;
  v_bps integer;
  v_fare integer;
  v_net integer;
begin
  if current_user not in ('authenticated', 'anon') then
    return NEW;
  end if;

  v_uid := auth.uid();
  v_req := NEW;
  v_from := OLD.status::text;
  v_to := v_req.status::text;
  v_is_driver := v_uid is not null and v_uid = OLD.driver_id;
  v_is_rider := v_uid is not null and v_uid = OLD.rider_id;
  v_scheduled := OLD.scheduled_for is not null or OLD.pickup_at is not null;
  v_claim := v_uid is not null
    and OLD.driver_id is null
    and v_req.driver_id = v_uid
    and v_from in ('searching', 'offered')
    and v_to in ('accepted', 'offered');

  -- Whitelist: start from the stored row.
  NEW := OLD;

  if v_to is distinct from v_from or v_claim then
    if v_claim then
      NEW.driver_id := v_uid;
      if v_to = 'accepted' then
        NEW.accepted_at := now();
      end if;
    elsif v_is_driver and (
      (v_from = 'accepted' and v_to = 'arriving')
      or (v_from in ('accepted', 'arriving') and v_to = 'arrived')
      or (v_from = 'arrived' and v_to = 'in_progress')
    ) then
      null;
    elsif v_is_rider and v_to = 'canceled' and (
      v_from in ('scheduled', 'searching', 'offered')
      or (v_from = 'accepted' and v_scheduled)
    ) then
      NEW.canceled_at := now();
    elsif v_from = 'offered' and v_to = 'searching'
      and OLD.driver_id is null and v_req.driver_id is null then
      null;
    else
      raise exception 'trip_transition_not_allowed'
        using errcode = '42501',
              detail = format('%s -> %s', v_from, v_to),
              hint = 'Use /api/driver?action=trip-status';
    end if;
    NEW.status := v_req.status;
  end if;

  -- Accept-time economics: recompute from the ladder, never trust the client.
  v_lock := coalesce(v_req.metadata ? 'driver_share_bps', false) and (
    (v_claim and v_to = 'accepted')
    or (v_is_driver and v_from = 'accepted' and v_to = 'accepted'
        and not coalesce(OLD.metadata ? 'driver_share_bps', false))
  );
  if v_lock then
    v_phase := nullif(OLD.metadata ->> 'offer_phase', '');
    if v_phase is null or v_phase not in ('exclusive', 'pool', 'scheduled', 'expired') then
      v_phase := case when v_scheduled or v_from = 'scheduled' then 'scheduled' else null end;
    end if;
    if v_phase is not null and v_phase <> 'expired' then
      v_bps := case
        when coalesce(OLD.metadata ->> 'offer_share_bps', '') ~ '^[0-9]{1,5}$'
          and (OLD.metadata ->> 'offer_share_bps')::integer > 0
          then (OLD.metadata ->> 'offer_share_bps')::integer
        when v_phase = 'pool' then 7000
        when v_phase = 'scheduled' then 7500
        else 8000
      end;
      v_bps := greatest(0, least(10000, v_bps));
      v_fare := greatest(0, coalesce(OLD.fare_cents, 0));
      v_net := case
        when v_bps = 8000 then v_fare - round(v_fare * 0.2)::integer
        else round(v_fare * v_bps / 10000.0)::integer
      end;
      NEW.driver_earnings_cents := v_net;
      NEW.platform_fee_cents := greatest(0, v_fare - v_net);
      NEW.metadata := coalesce(OLD.metadata, '{}'::jsonb) || jsonb_build_object(
        'driver_share_bps', v_bps,
        'driver_payout_cents', v_net,
        'accepted_offer_phase', v_phase
      );
    end if;
  end if;

  return NEW;
end;
$$;

-- Clients do not insert trips today (server endpoints do). If one does, it
-- cannot seed payout metadata or earnings.
create or replace function public.guard_trip_client_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return NEW;
  end if;
  NEW.metadata := coalesce(NEW.metadata, '{}'::jsonb)
    - 'payout' - 'driver_payout_cents' - 'driver_net_cents' - 'payout_cents'
    - 'driver_share_bps' - 'accepted_offer_phase' - 'platform_fee_cents'
    - 'tiger_heat' - 'boost_included_in_driver_net' - 'backup_standby_payout';
  NEW.driver_earnings_cents := null;
  NEW.platform_fee_cents := null;
  NEW.driver_wait_earnings_cents := 0;
  NEW.wait_fee_cents := 0;
  NEW.cancel_fee_cents := 0;
  NEW.switch_fee_cents := null;
  return NEW;
end;
$$;

revoke all on function public.guard_trip_client_write() from public, anon, authenticated;
revoke all on function public.guard_trip_client_insert() from public, anon, authenticated;

drop trigger if exists trips_aa_guard_client_write on public.trips;
create trigger trips_aa_guard_client_write
  before update on public.trips
  for each row execute function public.guard_trip_client_write();

drop trigger if exists trips_aa_guard_client_insert on public.trips;
create trigger trips_aa_guard_client_insert
  before insert on public.trips
  for each row execute function public.guard_trip_client_insert();

-- A participant may not hand the row to someone else.
drop policy if exists trips_update_participants on public.trips;
create policy trips_update_participants on public.trips
  for update to public
  using ((auth.uid() = rider_id) or (auth.uid() = driver_id))
  with check ((auth.uid() = rider_id) or (auth.uid() = driver_id));
