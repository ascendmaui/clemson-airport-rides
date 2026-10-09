-- Carpool is a ride tier stored on trips.tier. It is not a vehicle class.
-- vehicles.service_class stays standard | comfort, and matching already
-- treats every non-comfort trip tier like Standard.
--
-- If trips.tier is free text, this migration changes nothing. Booking can
-- store 'carpool' before this file is applied.
-- If trips.tier uses public.vehicle_tier, add that value so the insert
-- succeeds. Do not apply this file from the app deploy.

do $$
declare
  trip_type text;
begin
  select t.typname into trip_type
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_type t on t.oid = a.atttypid
  where n.nspname = 'public'
    and c.relname = 'trips'
    and a.attname = 'tier'
    and not a.attisdropped;

  if trip_type = 'vehicle_tier' then
    alter type public.vehicle_tier add value if not exists 'carpool';
  end if;
end $$;
