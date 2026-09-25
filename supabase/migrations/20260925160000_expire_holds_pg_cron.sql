-- External 15-minute trigger for /api/expire-unpaid-airport-holds via pg_cron + pg_net.
-- Vercel Hobby rejects a 15-minute schedule in vercel.json, so the database calls the
-- route instead. The bearer comes from Supabase Vault secret 'clemson_cron_secret'
-- (same value as Vercel env CRON_SECRET on clemson-rides production). The secret is
-- created out of band with vault.create_secret(...) and is never stored in this file.
-- Off-minute schedule: :07, :22, :37, :52.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create schema if not exists private;
revoke all on schema private from public;

create or replace function private.trigger_expire_unpaid_airport_holds()
returns bigint
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
    raise warning 'expire-unpaid-airport-holds: vault secret clemson_cron_secret missing; skipped';
    return null;
  end if;

  select net.http_get(
    url := 'https://clemson-rides.vercel.app/api/expire-unpaid-airport-holds',
    headers := jsonb_build_object('Authorization', 'Bearer ' || trim(v_secret)),
    timeout_milliseconds := 60000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function private.trigger_expire_unpaid_airport_holds() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function private.trigger_expire_unpaid_airport_holds() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function private.trigger_expire_unpaid_airport_holds() from authenticated;
  end if;
end $$;

-- Idempotent: replace any existing job with the same name.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'expire-unpaid-airport-holds') then
    perform cron.unschedule('expire-unpaid-airport-holds');
  end if;
end $$;

select cron.schedule(
  'expire-unpaid-airport-holds',
  '7,22,37,52 * * * *',
  $$select private.trigger_expire_unpaid_airport_holds();$$
);
