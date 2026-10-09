-- Model year on the vehicle a driver enters during onboarding.
-- Additive. Existing rows stay valid with a null year until the driver saves again.
-- Safe to run more than once. Skips quietly when vehicles is not in this database.

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'vehicles'
  ) then
    alter table public.vehicles add column if not exists year integer;
  end if;
end $$;
