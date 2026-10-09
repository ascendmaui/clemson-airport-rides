-- Break the trips -> driver_status -> trips RLS cycle while preserving the
-- assigned rider's active-trip presence read. The migration owner's definer
-- function reads trips without applying the caller's trips policies.
do $$
begin
  if to_regclass('public.driver_status') is null
     or to_regclass('public.trips') is null then
    return;
  end if;

  execute $function$
    create or replace function public.rider_has_active_trip_with_driver(p_driver_id uuid)
    returns boolean
    language sql stable security definer
    set search_path = public
    as $body$
      select exists (
        select 1 from public.trips t
        where t.driver_id = p_driver_id
          and t.rider_id = auth.uid()
          and t.status::text in ('accepted', 'arriving', 'arrived', 'in_progress')
      )
    $body$
  $function$;

  -- Supabase defaults grant EXECUTE directly to API roles as well as PUBLIC.
  -- RLS callers need authenticated EXECUTE; server/admin tooling keeps it too.
  revoke all on function public.rider_has_active_trip_with_driver(uuid) from public, anon;
  grant execute on function public.rider_has_active_trip_with_driver(uuid) to authenticated, service_role;

  execute 'drop policy if exists driver_status_assigned_rider_read on public.driver_status';
  execute $policy$
    create policy driver_status_assigned_rider_read
      on public.driver_status
      for select
      to authenticated
      using (public.rider_has_active_trip_with_driver(driver_id))
  $policy$;
  execute $comment$
    comment on policy driver_status_assigned_rider_read on public.driver_status is
      'Assigned rider can read this driver''s presence during an active trip when trip_driver_locations is empty.'
  $comment$;
end $$;
