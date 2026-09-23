-- SOS activations for admin review. Append-only for clients.
-- Applied to project awktabuhijrshmsmagpq (Clemson Rides). Additive only.

create table if not exists public.sos_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  trip_id uuid not null references public.trips (id) on delete cascade,
  lat double precision,
  lng double precision,
  channel text not null,
  created_at timestamptz not null default now(),
  constraint sos_events_channel_check check (
    channel = any (array[
      'tel_911'::text,
      'tel_cupd'::text,
      'sms'::text,
      'mailto'::text,
      'web_share'::text,
      'banner'::text
    ])
  ),
  constraint sos_events_lat_check check (lat is null or (lat >= -90 and lat <= 90)),
  constraint sos_events_lng_check check (lng is null or (lng >= -180 and lng <= 180))
);

comment on table public.sos_events is
  'Append-only SOS activations (user, trip, GPS, channel) for admin review.';

create index if not exists sos_events_trip_created_idx
  on public.sos_events (trip_id, created_at desc);

create index if not exists sos_events_created_idx
  on public.sos_events (created_at desc);

alter table public.sos_events enable row level security;

revoke all on table public.sos_events from public, anon;
grant select, insert on table public.sos_events to authenticated;

create or replace function public.can_activate_sos(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
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

revoke all on function public.can_activate_sos(uuid) from public;
grant execute on function public.can_activate_sos(uuid) to authenticated;

drop policy if exists sos_events_insert_active_party on public.sos_events;
create policy sos_events_insert_active_party
  on public.sos_events
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.can_activate_sos(trip_id)
  );

drop policy if exists sos_events_select_party_or_admin on public.sos_events;
create policy sos_events_select_party_or_admin
  on public.sos_events
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.trips t
      where t.id = sos_events.trip_id
        and (t.rider_id = auth.uid() or t.driver_id = auth.uid())
    )
    or public.is_admin()
  );

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sos_events'
  ) then
    alter publication supabase_realtime add table public.sos_events;
  end if;
end $$;
