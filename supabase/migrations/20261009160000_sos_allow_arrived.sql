-- Allow either participant to activate SOS while waiting at pickup.
create or replace function public.can_activate_sos(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.trips t
    where t.id = p_trip_id
      and t.status in (
        'accepted'::public.trip_status,
        'arriving'::public.trip_status,
        'arrived'::public.trip_status,
        'in_progress'::public.trip_status
      )
      and (t.rider_id = auth.uid() or t.driver_id = auth.uid())
  );
$$;

revoke all on function public.can_activate_sos(uuid) from public;
grant execute on function public.can_activate_sos(uuid) to authenticated;

-- Down:
-- create or replace function public.can_activate_sos(p_trip_id uuid)
-- returns boolean
-- language sql
-- stable
-- security definer
-- set search_path to 'public'
-- as $$
--   select exists (
--     select 1
--     from public.trips t
--     where t.id = p_trip_id
--       and t.status in (
--         'accepted'::public.trip_status,
--         'arriving'::public.trip_status,
--         'in_progress'::public.trip_status
--       )
--       and (t.rider_id = auth.uid() or t.driver_id = auth.uid())
--   );
-- $$;
--
-- revoke all on function public.can_activate_sos(uuid) from public;
-- grant execute on function public.can_activate_sos(uuid) to authenticated;
