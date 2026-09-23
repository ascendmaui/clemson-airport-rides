-- Ride-scoped messages. Rider and driver are equal parties:
-- both may select, both may insert while the trip is accepted / arriving / in_progress,
-- and the recipient (not the sender) may set read_at once.

create table if not exists public.trip_messages (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint trip_messages_body_len check (char_length(btrim(body)) between 1 and 500)
);

create index if not exists trip_messages_trip_created_idx
  on public.trip_messages (trip_id, created_at);

alter table public.trip_messages replica identity full;

alter table public.trip_messages enable row level security;

revoke all on table public.trip_messages from anon, public;
grant select, insert, update on table public.trip_messages to authenticated;

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
      and t.status in (
        'accepted'::public.trip_status,
        'arriving'::public.trip_status,
        'in_progress'::public.trip_status
      )
      and (t.rider_id = auth.uid() or t.driver_id = auth.uid())
  );
$$;

revoke all on function public.can_access_trip_messages(uuid) from public, anon;
revoke all on function public.can_send_trip_message(uuid) from public, anon;
grant execute on function public.can_access_trip_messages(uuid) to authenticated;
grant execute on function public.can_send_trip_message(uuid) to authenticated;

create or replace function public.trip_messages_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.body := btrim(new.body);
    new.read_at := null;
    if new.sender_id is distinct from auth.uid() then
      raise exception 'sender_id must be the signed-in user';
    end if;
    if not public.can_send_trip_message(new.trip_id) then
      raise exception 'messaging is only open for the rider and driver on an active trip';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.trip_id is distinct from old.trip_id
       or new.sender_id is distinct from old.sender_id
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

drop policy if exists trip_messages_select_parties on public.trip_messages;
create policy trip_messages_select_parties
  on public.trip_messages
  for select
  to authenticated
  using (public.can_access_trip_messages(trip_id));

drop policy if exists trip_messages_insert_parties on public.trip_messages;
create policy trip_messages_insert_parties
  on public.trip_messages
  for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and public.can_send_trip_message(trip_id)
  );

drop policy if exists trip_messages_update_read on public.trip_messages;
create policy trip_messages_update_read
  on public.trip_messages
  for update
  to authenticated
  using (
    sender_id <> auth.uid()
    and public.can_access_trip_messages(trip_id)
  )
  with check (
    sender_id <> auth.uid()
    and public.can_access_trip_messages(trip_id)
  );

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'trip_messages'
  ) then
    alter publication supabase_realtime add table public.trip_messages;
  end if;
end $$;
