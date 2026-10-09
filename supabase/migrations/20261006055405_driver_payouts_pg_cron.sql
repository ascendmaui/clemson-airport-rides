-- NOT applied. Daily driver payouts at 12:00 UTC, same shape as the
-- hold-expiry job. pg_cron and pg_net are already installed.
-- The bearer is vault secret clemson_cron_secret, which must equal
-- CRON_SECRET on the VPS (and on Vercel while that rollback still exists).
-- Off Vercel the route accepts the bearer alone. Do not send x-vercel-cron.
-- Do not schedule this on the VPS as well.

create extension if not exists pg_cron;
create extension if not exists pg_net;

create schema if not exists private;
revoke all on schema private from public;

create or replace function private.trigger_driver_payouts()
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
    raise warning 'driver-payouts: vault secret clemson_cron_secret missing; skipped';
    return null;
  end if;

  select net.http_get(
    url := 'https://clemsonrides.com/api/driver-payouts',
    headers := jsonb_build_object('Authorization', 'Bearer ' || trim(v_secret)),
    timeout_milliseconds := 60000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function private.trigger_driver_payouts() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function private.trigger_driver_payouts() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function private.trigger_driver_payouts() from authenticated;
  end if;
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'driver-payouts') then
    perform cron.unschedule('driver-payouts');
  end if;
end $$;

select cron.schedule(
  'driver-payouts',
  '0 12 * * *',
  $$select private.trigger_driver_payouts();$$
);
