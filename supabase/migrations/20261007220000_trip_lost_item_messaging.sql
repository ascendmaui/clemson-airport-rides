-- Lost-item reopen for trip messages.
-- The writable window is public.lost_item_thread_window() and nowhere else.
-- Keep that interval aligned with LOST_ITEM_THREAD_WINDOW_MS in src/lib/tripChatRules.js.

create or replace function public.lost_item_thread_window()
returns interval
language sql
immutable
as $$
  select interval '7 days';
$$;

revoke all on function public.lost_item_thread_window() from public, anon;
grant execute on function public.lost_item_thread_window() to authenticated, service_role;

alter table public.trip_messages
  add column if not exists sender_role text;

do $$
begin
  alter table public.trip_messages
    add constraint trip_messages_sender_role_check
    check (sender_role is null or sender_role in ('rider', 'driver'));
exception
  when duplicate_object then null;
end $$;

update public.trip_messages m
set sender_role = case
  when m.sender_id = t.rider_id then 'rider'
  when m.sender_id = t.driver_id then 'driver'
  else m.sender_role
end
from public.trips t
where t.id = m.trip_id
  and m.sender_role is null
  and (m.sender_id = t.rider_id or m.sender_id = t.driver_id);

create table if not exists public.trip_lost_item_reports (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id),
  reporter_role text not null,
  description text,
  status text not null default 'open',
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  constraint trip_lost_item_reports_role_check check (reporter_role in ('rider', 'driver')),
  constraint trip_lost_item_reports_status_check check (status in ('open', 'resolved')),
  constraint trip_lost_item_reports_description_len check (
    description is null or char_length(btrim(description)) between 1 and 80
  )
);

create index if not exists trip_lost_item_reports_trip_idx
  on public.trip_lost_item_reports (trip_id, opened_at desc);

create unique index if not exists trip_lost_item_one_open_idx
  on public.trip_lost_item_reports (trip_id)
  where status = 'open';

alter table public.trip_lost_item_reports replica identity full;
alter table public.trip_lost_item_reports enable row level security;

revoke all on table public.trip_lost_item_reports from anon, public;
grant select, insert, update on table public.trip_lost_item_reports to authenticated;

create or replace function public.can_access_trip_messages(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.trips t
    where t.id = p_trip_id
      and (t.rider_id = auth.uid() or t.driver_id = auth.uid())
  );
$$;

create or replace function public.can_open_lost_item_report(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.trips t
    where t.id = p_trip_id
      and t.status = 'completed'::public.trip_status
      and t.driver_id is not null
      and t.completed_at is not null
      and t.completed_at + public.lost_item_thread_window() >= now()
      and (t.rider_id = auth.uid() or t.driver_id = auth.uid())
  );
$$;

create or replace function public.can_send_trip_message(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.trips t
    where t.id = p_trip_id
      and (t.rider_id = auth.uid() or t.driver_id = auth.uid())
      and (
        t.status in (
          'accepted'::public.trip_status,
          'arriving'::public.trip_status,
          'arrived'::public.trip_status,
          'in_progress'::public.trip_status
        )
        or (
          t.status = 'completed'::public.trip_status
          and exists (
            select 1
            from public.trip_lost_item_reports r
            where r.trip_id = t.id
              and r.status = 'open'
              and r.opened_at + public.lost_item_thread_window() >= now()
          )
        )
      )
  );
$$;

revoke all on function public.can_access_trip_messages(uuid) from public, anon;
revoke all on function public.can_open_lost_item_report(uuid) from public, anon;
revoke all on function public.can_send_trip_message(uuid) from public, anon;
grant execute on function public.can_access_trip_messages(uuid) to authenticated;
grant execute on function public.can_open_lost_item_report(uuid) to authenticated;
grant execute on function public.can_send_trip_message(uuid) to authenticated;

create or replace function public.trip_messages_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  party_rider uuid;
  party_driver uuid;
begin
  if tg_op = 'INSERT' then
    new.body := btrim(new.body);
    new.read_at := null;
    if new.sender_id is distinct from auth.uid() then
      raise exception 'sender_id must be the signed-in user';
    end if;
    select t.rider_id, t.driver_id into party_rider, party_driver
    from public.trips t
    where t.id = new.trip_id;
    if new.sender_id = party_rider then
      new.sender_role := 'rider';
    elsif new.sender_id = party_driver then
      new.sender_role := 'driver';
    else
      new.sender_role := null;
    end if;
    if not public.can_send_trip_message(new.trip_id) then
      raise exception 'messaging is only open for the rider and driver on an active trip or an open lost-item thread';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.trip_id is distinct from old.trip_id
       or new.sender_id is distinct from old.sender_id
       or new.sender_role is distinct from old.sender_role
       or new.body is distinct from old.body
       or new.created_at is distinct from old.created_at
    then
      raise exception 'only read_at may be updated';
    end if;
    if new.read_at is null then
      raise exception 'read_at cannot be cleared';
    end if;
    if old.read_at is not null and new.read_at is distinct from old.read_at then
      raise exception 'read_at is already set';
    end if;
    if old.sender_id = auth.uid() then
      raise exception 'sender cannot mark own message read';
    end if;
    if not public.can_access_trip_messages(old.trip_id) then
      raise exception 'not a participant on this trip';
    end if;
    return new;
  end if;

  return new;
end;
$$;

revoke all on function public.trip_messages_before_write() from public, anon;
grant execute on function public.trip_messages_before_write() to authenticated;

drop trigger if exists trip_messages_before_write on public.trip_messages;
create trigger trip_messages_before_write
  before insert or update on public.trip_messages
  for each row execute function public.trip_messages_before_write();

create or replace function public.trip_lost_item_reports_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  party_rider uuid;
  party_driver uuid;
begin
  if tg_op = 'INSERT' then
    if new.description is not null then
      new.description := nullif(btrim(new.description), '');
    end if;
    if new.reporter_id is distinct from auth.uid() then
      raise exception 'reporter_id must be the signed-in user';
    end if;
    if not public.can_open_lost_item_report(new.trip_id) then
      raise exception 'a lost item can only be reported on a recently completed trip';
    end if;
    select t.rider_id, t.driver_id into party_rider, party_driver
    from public.trips t
    where t.id = new.trip_id;
    if auth.uid() = party_driver then
      new.reporter_role := 'driver';
    elsif auth.uid() = party_rider then
      new.reporter_role := 'rider';
    else
      raise exception 'not a participant on this trip';
    end if;
    new.status := 'open';
    new.opened_at := now();
    new.resolved_at := null;
    new.resolved_by := null;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.trip_id is distinct from old.trip_id
       or new.reporter_id is distinct from old.reporter_id
       or new.reporter_role is distinct from old.reporter_role
       or new.description is distinct from old.description
       or new.opened_at is distinct from old.opened_at
    then
      raise exception 'only resolution fields may be updated';
    end if;
    if old.status is distinct from 'open' or new.status is distinct from 'resolved' then
      raise exception 'lost-item thread can only move from open to resolved';
    end if;
    if new.resolved_by is distinct from auth.uid() then
      raise exception 'resolved_by must be the signed-in user';
    end if;
    if not public.can_access_trip_messages(old.trip_id) then
      raise exception 'not a participant on this trip';
    end if;
    new.resolved_at := now();
    return new;
  end if;

  return new;
end;
$$;

revoke all on function public.trip_lost_item_reports_before_write() from public, anon;
grant execute on function public.trip_lost_item_reports_before_write() to authenticated;

drop trigger if exists trip_lost_item_reports_before_write on public.trip_lost_item_reports;
create trigger trip_lost_item_reports_before_write
  before insert or update on public.trip_lost_item_reports
  for each row execute function public.trip_lost_item_reports_before_write();

drop policy if exists trip_messages_select_admin on public.trip_messages;
create policy trip_messages_select_admin
  on public.trip_messages
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists trip_lost_item_select_parties on public.trip_lost_item_reports;
create policy trip_lost_item_select_parties
  on public.trip_lost_item_reports
  for select
  to authenticated
  using (public.can_access_trip_messages(trip_id));

drop policy if exists trip_lost_item_select_admin on public.trip_lost_item_reports;
create policy trip_lost_item_select_admin
  on public.trip_lost_item_reports
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists trip_lost_item_insert_parties on public.trip_lost_item_reports;
create policy trip_lost_item_insert_parties
  on public.trip_lost_item_reports
  for insert
  to authenticated
  with check (
    reporter_id = auth.uid()
    and public.can_open_lost_item_report(trip_id)
  );

drop policy if exists trip_lost_item_update_resolve on public.trip_lost_item_reports;
create policy trip_lost_item_update_resolve
  on public.trip_lost_item_reports
  for update
  to authenticated
  using (
    status = 'open'
    and public.can_access_trip_messages(trip_id)
  )
  with check (
    status = 'resolved'
    and resolved_by = auth.uid()
    and public.can_access_trip_messages(trip_id)
  );

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'trip_lost_item_reports'
     )
  then
    alter publication supabase_realtime add table public.trip_lost_item_reports;
  end if;
end $$;
