-- Extra vehicle photos for driver onboarding and profile.
-- Files stay in the existing private driver-documents bucket.
-- Apply after driver_onboarding_approval.sql so the bucket and is_admin() exist.
-- One driver can store many exterior, interior, and other photos.

create table if not exists public.driver_vehicle_photos (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  storage_path text not null unique,
  kind text not null,
  created_at timestamptz not null default now(),
  constraint driver_vehicle_photos_kind_check check (kind in ('exterior', 'interior', 'other'))
);

create index if not exists driver_vehicle_photos_profile_idx
  on public.driver_vehicle_photos (profile_id, created_at);

alter table public.driver_vehicle_photos enable row level security;

drop policy if exists driver_vehicle_photos_owner on public.driver_vehicle_photos;
create policy driver_vehicle_photos_owner
  on public.driver_vehicle_photos
  for all
  to authenticated
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

drop policy if exists driver_vehicle_photos_admin on public.driver_vehicle_photos;
create policy driver_vehicle_photos_admin
  on public.driver_vehicle_photos
  for select
  to authenticated
  using (public.is_admin());

grant select, insert, delete on table public.driver_vehicle_photos to authenticated, service_role;
