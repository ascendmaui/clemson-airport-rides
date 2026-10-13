-- Riders on an active trip may read the assigned driver's presence row.
-- Native and web riders prefer trip_driver_locations. This policy is the
-- fallback when that row is empty. It does not enable RLS: driver write
-- policies are not in this repo, and enabling RLS here would block drivers
-- from updating their own presence.

do $$
begin
  if to_regclass('public.driver_status') is null then
    return;
  end if;

  execute 'drop policy if exists driver_status_assigned_rider_read on public.driver_status';
  execute $policy$
    create policy driver_status_assigned_rider_read
      on public.driver_status
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.trips t
          where t.driver_id = public.driver_status.driver_id
            and t.rider_id = auth.uid()
            and t.status::text in ('accepted', 'arriving', 'arrived', 'in_progress')
        )
      )
  $policy$;
  execute $comment$
    comment on policy driver_status_assigned_rider_read on public.driver_status is
      'Assigned rider can read this driver''s presence during an active trip when trip_driver_locations is empty.'
  $comment$;
end $$;

do $$
begin
  if to_regclass('public.driver_status') is null then
    return;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'driver_status'
     ) then
    alter publication supabase_realtime add table public.driver_status;
  end if;
end $$;
