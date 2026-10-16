-- Account deletion calls auth.admin.deleteUser. If public.profiles.id
-- references auth.users ON DELETE CASCADE, that call erases the profile and
-- every tax or payout row that cascades from it (driver_w9, mileage logs).
-- Drop that foreign key when it exists so the anonymized profile, completed
-- ride rows, payout rows, and W-9 stay after the auth user is gone.
--
-- This file is not applied by the app or by a deploy. Run it yourself
-- against the database before relying on retained tax rows. Until it is
-- applied, deleteUser still cascades if the foreign key is ON DELETE CASCADE.

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_class f on f.oid = c.confrelid
    join pg_namespace fn on fn.oid = f.relnamespace
    where n.nspname = 'public'
      and t.relname = 'profiles'
      and c.contype = 'f'
      and fn.nspname = 'auth'
      and f.relname = 'users'
  loop
    execute format('alter table public.profiles drop constraint %I', constraint_name);
  end loop;
end $$;
