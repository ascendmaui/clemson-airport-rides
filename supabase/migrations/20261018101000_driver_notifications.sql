-- Driver notification inbox.
-- Additive only: a new table, own-row select/update policies, and signup alerts
-- for one admin account. Clients do not insert. The service role, the API, and
-- the security-definer trigger below write rows.
--
-- TestFlight join alerts are intentionally not part of this migration.

create table if not exists public.driver_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists driver_notifications_user_created_idx
  on public.driver_notifications (user_id, created_at desc);

-- One admin signup alert per new account, whether auth.users or profiles arrives first.
create unique index if not exists driver_notifications_admin_signup_once
  on public.driver_notifications ((data->>'signup_user_id'))
  where type = 'admin_signup' and (data->>'signup_user_id') is not null;

alter table public.driver_notifications enable row level security;

drop policy if exists driver_notifications_own_select on public.driver_notifications;
create policy driver_notifications_own_select on public.driver_notifications
  for select to authenticated using (user_id = auth.uid());

drop policy if exists driver_notifications_own_update on public.driver_notifications;
create policy driver_notifications_own_update on public.driver_notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.driver_notifications from public, anon, authenticated;
grant select, update on public.driver_notifications to authenticated;
grant all on public.driver_notifications to service_role;

-- Realtime so the open Driver app can toast a new row. Safe to skip when the
-- publication is missing (local databases that have not enabled it).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'driver_notifications'
     ) then
    alter publication supabase_realtime add table public.driver_notifications;
  end if;
end $$;

create extension if not exists pg_net;

create schema if not exists private;
revoke all on schema private from public;

-- John's admin account. Signup alerts are inserted for this user only.
create or replace function private.dispatch_admin_signup_push(
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_source text
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
  v_request_id bigint;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'clemson_cron_secret'
  limit 1;

  if v_secret is null or length(trim(v_secret)) = 0 then
    raise warning 'admin-signup-alert: vault secret clemson_cron_secret missing; push skipped';
    return null;
  end if;

  select net.http_post(
    url := 'https://clemsonrides.com/api/driver?action=admin-signup-alert',
    body := jsonb_build_object(
      'userId', p_user_id,
      'email', p_email,
      'fullName', p_full_name,
      'source', p_source
    ),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || trim(v_secret),
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 15000
  ) into v_request_id;

  return v_request_id;
exception when others then
  raise warning 'admin-signup-alert push: %', sqlerrm;
  return null;
end;
$$;

create or replace function private.enqueue_admin_signup_alert(
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_source text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := 'f2262bf6-1fef-4d90-9e2e-7edfb7f097dc';
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_who text;
  v_inserted integer := 0;
begin
  if p_user_id is null then
    return;
  end if;

  if v_name is not null and v_email is not null then
    v_who := v_name || ' (' || v_email || ')';
  else
    v_who := coalesce(v_name, v_email, 'A new account');
  end if;

  insert into public.driver_notifications (user_id, type, title, body, data)
  values (
    v_admin,
    'admin_signup',
    'New Clemson Rides account',
    v_who || ' just signed up.',
    jsonb_build_object(
      'kind', 'admin_signup',
      'signup_user_id', p_user_id,
      'email', v_email,
      'full_name', v_name,
      'source', p_source
    )
  );
  get diagnostics v_inserted = row_count;

  if v_inserted > 0 then
    perform private.dispatch_admin_signup_push(p_user_id, v_email, v_name, p_source);
  end if;
exception
  when unique_violation then
    return;
  when others then
    raise warning 'admin-signup-alert: %', sqlerrm;
end;
$$;

create or replace function public.enqueue_admin_signup_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform private.enqueue_admin_signup_alert(
    new.id,
    new.email,
    nullif(btrim(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', '')), ''),
    'auth.users'
  );
  return new;
exception when others then
  raise warning 'admin-signup-alert auth.users: %', sqlerrm;
  return new;
end;
$$;

create or replace function public.enqueue_admin_signup_from_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform private.enqueue_admin_signup_alert(
    new.id,
    new.email,
    new.full_name,
    'profiles'
  );
  return new;
exception when others then
  raise warning 'admin-signup-alert profiles: %', sqlerrm;
  return new;
end;
$$;

revoke all on function private.dispatch_admin_signup_push(uuid, text, text, text) from public;
revoke all on function private.enqueue_admin_signup_alert(uuid, text, text, text) from public;
revoke all on function public.enqueue_admin_signup_from_auth_user() from public;
revoke all on function public.enqueue_admin_signup_from_profile() from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function private.dispatch_admin_signup_push(uuid, text, text, text) from anon;
    revoke all on function private.enqueue_admin_signup_alert(uuid, text, text, text) from anon;
    revoke all on function public.enqueue_admin_signup_from_auth_user() from anon;
    revoke all on function public.enqueue_admin_signup_from_profile() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function private.dispatch_admin_signup_push(uuid, text, text, text) from authenticated;
    revoke all on function private.enqueue_admin_signup_alert(uuid, text, text, text) from authenticated;
    revoke all on function public.enqueue_admin_signup_from_auth_user() from authenticated;
    revoke all on function public.enqueue_admin_signup_from_profile() from authenticated;
  end if;

  if to_regclass('auth.users') is not null then
    drop trigger if exists auth_users_admin_signup_alert on auth.users;
    create trigger auth_users_admin_signup_alert
    after insert on auth.users
    for each row
    execute function public.enqueue_admin_signup_from_auth_user();
  end if;

  if to_regclass('public.profiles') is not null then
    drop trigger if exists profiles_admin_signup_alert on public.profiles;
    create trigger profiles_admin_signup_alert
    after insert on public.profiles
    for each row
    execute function public.enqueue_admin_signup_from_profile();
  end if;
end $$;
