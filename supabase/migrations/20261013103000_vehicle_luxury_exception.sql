-- Driver-owned vehicles may be older than 2019 only as a Luxury exception.
-- Additive. luxury_exception stays null on existing rows.
-- The year check is NOT VALID so this migration does not fail on old rows.
-- Safe to run more than once. Skips quietly when vehicles is not in this database.

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'vehicles'
  ) then
    alter table public.vehicles add column if not exists luxury_exception boolean;

    if not exists (
      select 1
      from pg_constraint
      where conname = 'vehicles_year_luxury_exception_check'
    ) then
      alter table public.vehicles
        add constraint vehicles_year_luxury_exception_check
        check (year is null or year >= 2019 or luxury_exception)
        not valid;
    end if;
  end if;
end $$;
