-- Already applied in production.
-- Supabase migration name: repoint_hold_expiry_cron_to_clemsonrides_com
-- Applied about 04:33 UTC on 2026-10-05.
--
-- The live function previously called
-- https://clemson-rides.vercel.app/api/expire-unpaid-airport-holds
-- (that alias is not on the clemson-airport-rides Vercel project).
-- The body below is the same function with the public site URL.
-- CREATE OR REPLACE only. The existing pg_cron job keeps its schedule
-- and calls this function by name. Do not add another hold-expiry scheduler.

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
    url := 'https://clemsonrides.com/api/expire-unpaid-airport-holds',
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
