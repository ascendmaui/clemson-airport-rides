-- Title status on the vehicle a driver enters during sign-up.
-- Additive. Existing rows stay valid with a null title_status until the driver saves again.
-- Clean and rebuilt may be stored. Salvage is not a valid stored value.
-- Safe to run more than once. Skips quietly when vehicles is not in this database.

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'vehicles'
  ) then
    alter table public.vehicles add column if not exists title_status text;

    if not exists (
      select 1
      from pg_constraint
      where conname = 'vehicles_title_status_check'
    ) then
      alter table public.vehicles
        add constraint vehicles_title_status_check
        check (title_status is null or title_status in ('clean', 'rebuilt'));
    end if;
  end if;
end $$;
