-- Driver years of driving experience, shown to riders as "7 yrs experience".
-- Additive: one nullable column, and the rider-facing card/profile functions
-- return it as a new trailing column. A function's OUT columns cannot change
-- with CREATE OR REPLACE, so each one is dropped and recreated in this same
-- transaction with its existing body and grants.

alter table public.profiles
  add column if not exists years_experience integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_years_experience_range'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_years_experience_range
      check (years_experience is null or (years_experience >= 0 and years_experience <= 70));
  end if;
end $$;

comment on column public.profiles.years_experience is
  'Years of driving experience the driver reports. Null hides the line on rider cards.';

drop function if exists public.list_rider_driver_cards(uuid[]);
create function public.list_rider_driver_cards(ids uuid[])
returns table (
  id uuid,
  first_name text,
  rating_avg numeric,
  rating_count integer,
  standing text,
  color text,
  make text,
  model text,
  plate text,
  tier text,
  years_experience integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p.id,
    public.rider_driver_first_name(p.full_name) as first_name,
    p.rating_avg,
    p.rating_count,
    p.standing,
    v.color,
    v.make,
    v.model,
    v.plate,
    v.tier::text,
    p.years_experience
  from public.profiles p
  join public.driver_applications da
    on da.profile_id = p.id
   and da.onboarding_status = 'approved'
  left join lateral (
    select vehicles.color, vehicles.make, vehicles.model, vehicles.plate, vehicles.tier
    from public.vehicles
    where vehicles.driver_id = p.id
    limit 1
  ) v on true
  where ids is not null
    and p.id = any(ids);
$$;
revoke all on function public.list_rider_driver_cards(uuid[]) from public, anon;
grant execute on function public.list_rider_driver_cards(uuid[]) to authenticated, service_role;

drop function if exists public.list_driver_cards(uuid[]);
create function public.list_driver_cards(ids uuid[])
returns table (
  id uuid,
  full_name text,
  rating_avg numeric,
  rating_count integer,
  standing text,
  color text,
  make text,
  model text,
  plate text,
  tier text,
  years_experience integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p.id,
    public.rider_driver_first_name(p.full_name) as full_name,
    p.rating_avg,
    p.rating_count,
    p.standing,
    v.color,
    v.make,
    v.model,
    v.plate,
    v.tier::text,
    p.years_experience
  from public.profiles p
  join public.driver_applications da
    on da.profile_id = p.id
   and da.onboarding_status = 'approved'
  left join lateral (
    select vehicles.color, vehicles.make, vehicles.model, vehicles.plate, vehicles.tier
    from public.vehicles
    where vehicles.driver_id = p.id
    limit 1
  ) v on true
  where ids is not null
    and p.id = any(ids);
$$;
revoke all on function public.list_driver_cards(uuid[]) from public, anon;
grant execute on function public.list_driver_cards(uuid[]) to authenticated, service_role;

drop function if exists public.rider_driver_profile(uuid);
create function public.rider_driver_profile(target uuid)
returns table (
  id uuid,
  first_name text,
  avatar_url text,
  bio text,
  ride_style text,
  favorite_spots jsonb,
  music_taste text,
  rating_avg numeric,
  rating_count integer,
  student_verified_at timestamptz,
  role text,
  years_experience integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    p.id,
    public.rider_driver_first_name(p.full_name) as first_name,
    p.avatar_url,
    p.bio,
    p.ride_style,
    to_jsonb(p.favorite_spots) as favorite_spots,
    p.music_taste,
    p.rating_avg,
    p.rating_count,
    p.student_verified_at,
    p.role::text,
    p.years_experience
  from public.profiles p
  where p.id = target
    and exists (
      select 1 from public.trips t
      where t.rider_id = auth.uid()
        and t.driver_id = p.id
        and t.status::text = any (array['accepted', 'arriving', 'arrived', 'in_progress', 'completed'])
    );
$$;
revoke all on function public.rider_driver_profile(uuid) from public, anon;
grant execute on function public.rider_driver_profile(uuid) to authenticated, service_role;
