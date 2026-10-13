-- Clickwrap acceptance of the Driver Agreement.
-- One row per driver per agreement version. A new version is a new row,
-- so the next launch can ask again. app_version and ip_address stay null
-- when the client or the request does not have them.
--
-- Down (reversible):
--   drop table if exists public.driver_clickwrap_acceptances;

create table if not exists public.driver_clickwrap_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  agreement_version text not null,
  accepted_at timestamptz not null default now(),
  app_version text,
  ip_address text,
  unique (user_id, agreement_version)
);

comment on table public.driver_clickwrap_acceptances is
  'Server record that a driver accepted a Driver Agreement version. Writes go through the service role so the user id comes from the session.';

create index if not exists driver_clickwrap_acceptances_user_idx
  on public.driver_clickwrap_acceptances (user_id, accepted_at desc);

alter table public.driver_clickwrap_acceptances enable row level security;

drop policy if exists driver_clickwrap_select_own on public.driver_clickwrap_acceptances;
create policy driver_clickwrap_select_own
  on public.driver_clickwrap_acceptances
  for select
  to authenticated
  using (user_id = auth.uid());

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.driver_clickwrap_acceptances from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.driver_clickwrap_acceptances from authenticated;
    grant select on public.driver_clickwrap_acceptances to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant all on public.driver_clickwrap_acceptances to service_role;
  end if;
end $$;
