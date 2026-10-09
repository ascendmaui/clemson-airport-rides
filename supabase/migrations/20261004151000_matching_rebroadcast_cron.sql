-- Every minute, sweep due offers using the existing Vault/Vercel CRON_SECRET.
-- Deploy the API and deadline migration before enabling this job.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create schema if not exists private;
revoke all on schema private from public;

create or replace function private.trigger_matching_rebroadcast()
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
    raise warning 'matching-rebroadcast: vault secret clemson_cron_secret missing; skipped';
    return null;
  end if;

  select net.http_get(
    url := 'https://clemsonrides.com/api/driver?action=rebroadcast-offers',
    headers := jsonb_build_object('Authorization', 'Bearer ' || trim(v_secret)),
    timeout_milliseconds := 60000
  ) into v_request_id;

  return v_request_id;
end;
$$;

revoke all on function private.trigger_matching_rebroadcast() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function private.trigger_matching_rebroadcast() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function private.trigger_matching_rebroadcast() from authenticated;
  end if;
end $$;

-- Idempotent: replace any existing job with the same name.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'matching-rebroadcast') then
    perform cron.unschedule('matching-rebroadcast');
  end if;
end $$;

select cron.schedule(
  'matching-rebroadcast',
  '* * * * *',
  $$select private.trigger_matching_rebroadcast();$$
);
