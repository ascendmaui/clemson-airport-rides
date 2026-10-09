-- Backstop for stale online heartbeats (P1: TF30 kept writing online:true after END).
-- After an explicit offline, a driver's own client cannot flip driver_status.online back to
-- true for 3600 seconds unless the write is a GO action:
--   * new builds send online_source = 'go' on GO and 'heartbeat' on location heartbeats;
--   * builds without online_source (TestFlight 29/30, web) are classified by shape: their
--     location heartbeats always bump location_updated_at, their GO writes never do.
-- A rejected flip keeps the location update and leaves online = false (no client error, so old
-- builds do not show a failure banner). Service-role and admin writes are not affected.
-- online_source is per write: updates clear it so a stale value never carries over.

alter table public.driver_status add column if not exists offline_at timestamptz;
alter table public.driver_status add column if not exists online_source text;

create or replace function public.guard_driver_status_online()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_window constant interval := interval '3600 seconds';
  v_source text;
  v_go boolean;
begin
  -- Upserts run BEFORE INSERT first and EXCLUDED carries its result, so the tag is kept there.
  if TG_OP <> 'UPDATE' then
    return NEW;
  end if;
  v_source := case when NEW.online_source is distinct from OLD.online_source then NEW.online_source end;
  NEW.online_source := null;
  if coalesce(OLD.online, false) and not coalesce(NEW.online, false) then
    NEW.offline_at := now();
  elsif not coalesce(OLD.online, false) and coalesce(NEW.online, false) then
    v_go := coalesce(v_source = 'go', false)
      or (v_source is null and NEW.location_updated_at is not distinct from OLD.location_updated_at);
    if OLD.offline_at is not null
      and OLD.offline_at > now() - v_window
      and auth.uid() is not null
      and auth.uid() = NEW.driver_id
      and not v_go then
      NEW.online := false;
      NEW.offline_at := OLD.offline_at;
    else
      NEW.offline_at := null;
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists driver_status_online_guard on public.driver_status;
create trigger driver_status_online_guard
before insert or update on public.driver_status
for each row execute function public.guard_driver_status_online();

revoke all on function public.guard_driver_status_online() from public;
