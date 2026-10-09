-- Private storage supports the fallback already shipped in the driver app.
create table if not exists public.driver_push_tokens (
  driver_id uuid primary key references auth.users(id) on delete cascade,
  token text not null,
  platform text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.driver_push_tokens enable row level security;

drop policy if exists driver_push_tokens_own_select on public.driver_push_tokens;
create policy driver_push_tokens_own_select on public.driver_push_tokens
  for select to authenticated using (driver_id = auth.uid());
drop policy if exists driver_push_tokens_own_insert on public.driver_push_tokens;
create policy driver_push_tokens_own_insert on public.driver_push_tokens
  for insert to authenticated with check (driver_id = auth.uid());
drop policy if exists driver_push_tokens_own_update on public.driver_push_tokens;
create policy driver_push_tokens_own_update on public.driver_push_tokens
  for update to authenticated using (driver_id = auth.uid()) with check (driver_id = auth.uid());
drop policy if exists driver_push_tokens_own_delete on public.driver_push_tokens;
create policy driver_push_tokens_own_delete on public.driver_push_tokens
  for delete to authenticated using (driver_id = auth.uid());

revoke all on public.driver_push_tokens from public, anon;
grant select, insert, update, delete on public.driver_push_tokens to authenticated;
grant all on public.driver_push_tokens to service_role;

-- Trip subscriptions are filtered by the existing rider/driver SELECT policies.
do $$
begin
  if to_regclass('public.trips') is null then
    return;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'trips'
     ) then
    alter publication supabase_realtime add table public.trips;
  end if;
end $$;
