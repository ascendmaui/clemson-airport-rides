-- Rider-facing driver identity. Additive: new helper, view, and RPCs.
-- Existing list_driver_cards and counterpart_profile keep their signatures.
-- A rider never receives the driver's phone, last name, or last initial.

create or replace function public.rider_driver_first_name(p_full_name text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  raw text := btrim(coalesce(p_full_name, ''));
  token text;
  bare text;
begin
  if raw = '' then return null; end if;
  if position('@' in raw) > 0 then
    raw := btrim(split_part(raw, '@', 1));
  end if;
  if position(',' in raw) > 0 then
    token := btrim(split_part(raw, ',', 2));
    if token <> '' then raw := token; end if;
  end if;
  token := regexp_replace(split_part(raw, ' ', 1), '^[^[:alnum:]]+|[^[:alnum:]''’.-]+$', '', 'g');
  bare := lower(replace(token, '.', ''));
  if bare in ('mr', 'mrs', 'ms', 'mx', 'dr', 'prof', 'miss', 'professor') then
    raw := btrim(substr(raw, char_length(split_part(raw, ' ', 1)) + 1));
    token := regexp_replace(split_part(raw, ' ', 1), '^[^[:alnum:]]+|[^[:alnum:]''’.-]+$', '', 'g');
    bare := lower(replace(token, '.', ''));
  end if;
  if token is null or char_length(bare) < 2 then return null; end if;
  return token;
end;
$$;

revoke all on function public.rider_driver_first_name(text) from public;

-- Picker cards. first_name only. No phone, email, or full name column.
create or replace function public.list_rider_driver_cards(ids uuid[])
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
  tier text
)
language sql
stable
security definer
set search_path = public
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
    v.tier
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

revoke all on function public.list_rider_driver_cards(uuid[]) from public;
grant execute on function public.list_rider_driver_cards(uuid[]) to anon, authenticated, service_role;

-- Matched driver profile for the rider on that trip. No phone column.
create or replace function public.rider_driver_profile(target uuid)
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
  role text
)
language sql
stable
security definer
set search_path = public
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
    p.role
  from public.profiles p
  where p.id = target
    and exists (
      select 1 from public.trips t
      where t.rider_id = auth.uid()
        and t.driver_id = p.id
        and t.status::text = any (array['accepted', 'arriving', 'arrived', 'in_progress', 'completed'])
    );
$$;

revoke all on function public.rider_driver_profile(uuid) from public;
grant execute on function public.rider_driver_profile(uuid) to authenticated, service_role;

create or replace view public.rider_driver_cards as
select
  p.id,
  public.rider_driver_first_name(p.full_name) as first_name,
  p.avatar_url,
  p.rating_avg,
  p.rating_count,
  p.standing,
  v.color,
  v.make,
  v.model,
  v.plate,
  v.tier
from public.profiles p
join public.driver_applications da
  on da.profile_id = p.id
 and da.onboarding_status = 'approved'
left join lateral (
  select vehicles.color, vehicles.make, vehicles.model, vehicles.plate, vehicles.tier
  from public.vehicles
  where vehicles.driver_id = p.id
  limit 1
) v on true;

revoke all on table public.rider_driver_cards from public;
grant select on table public.rider_driver_cards to anon, authenticated, service_role;

-- Same signature as list_driver_cards. The name column is the first name only.
create or replace function public.list_driver_cards(ids uuid[])
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
  tier text
)
language sql
stable
security definer
set search_path = public
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
    v.tier
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

revoke all on function public.list_driver_cards(uuid[]) from public;
grant execute on function public.list_driver_cards(uuid[]) to anon, authenticated, service_role;

-- Same signature. A rider matched to this driver gets the first name and a null phone.
-- The driver on that trip still receives the rider's own name and phone.
create or replace function public.counterpart_profile(target uuid)
returns table (
  id uuid,
  full_name text,
  avatar_url text,
  bio text,
  ride_style text,
  favorite_spots jsonb,
  music_taste text,
  rating_avg numeric,
  rating_count integer,
  student_verified_at timestamptz,
  phone text,
  role text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    case
      when p.id = auth.uid() then p.full_name
      when exists (
        select 1 from public.trips t
        where t.driver_id = auth.uid()
          and t.rider_id = p.id
          and t.status::text = any (array['accepted', 'arriving', 'arrived', 'in_progress', 'completed'])
      ) then p.full_name
      else public.rider_driver_first_name(p.full_name)
    end as full_name,
    p.avatar_url,
    p.bio,
    p.ride_style,
    to_jsonb(p.favorite_spots) as favorite_spots,
    p.music_taste,
    p.rating_avg,
    p.rating_count,
    p.student_verified_at,
    case
      when p.id = auth.uid() then p.phone
      when exists (
        select 1 from public.trips t
        where t.driver_id = auth.uid()
          and t.rider_id = p.id
          and t.status::text = any (array['accepted', 'arriving', 'arrived', 'in_progress', 'completed'])
      ) then p.phone
      else null
    end as phone,
    p.role
  from public.profiles p
  where p.id = target
    and (
      p.id = auth.uid()
      or exists (
        select 1 from public.trips t
        where t.status::text = any (array['accepted', 'arriving', 'arrived', 'in_progress', 'completed'])
          and (
            (t.rider_id = auth.uid() and t.driver_id = p.id)
            or (t.driver_id = auth.uid() and t.rider_id = p.id)
          )
      )
    );
$$;

revoke all on function public.counterpart_profile(uuid) from public;
grant execute on function public.counterpart_profile(uuid) to authenticated;
