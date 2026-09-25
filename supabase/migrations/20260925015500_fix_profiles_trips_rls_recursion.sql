create or replace function public.is_driver_or_admin_role()
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
set row_security to 'off'
as $$
begin
  return exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = any (array['driver'::public.user_role, 'admin'::public.user_role])
  );
end;
$$;
revoke all on function public.is_driver_or_admin_role() from public;
grant execute on function public.is_driver_or_admin_role() to authenticated;

drop policy if exists trips_driver_scheduled_select on public.trips;
create policy trips_driver_scheduled_select on public.trips
  for select to authenticated
  using ((status = 'scheduled'::public.trip_status) and (driver_id is null) and public.is_driver_or_admin_role());
