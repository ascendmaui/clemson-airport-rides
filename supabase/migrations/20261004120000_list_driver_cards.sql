-- Rider picker cards. profiles and vehicles stay private (billing columns,
-- matched-only privacy). This function returns the name, rating, and vehicle
-- a rider already sees on an approved driver's card.

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
  tier text,
  is_tesla boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.full_name,
    p.rating_avg,
    p.rating_count,
    p.standing,
    v.color,
    v.make,
    v.model,
    v.plate,
    v.tier,
    v.is_tesla
  from public.profiles p
  join public.driver_applications da
    on da.profile_id = p.id
   and da.onboarding_status = 'approved'
  left join lateral (
    select vehicles.color, vehicles.make, vehicles.model, vehicles.plate, vehicles.tier, vehicles.is_tesla
    from public.vehicles
    where vehicles.driver_id = p.id
    limit 1
  ) v on true
  where ids is not null
    and p.id = any(ids);
$$;

revoke all on function public.list_driver_cards(uuid[]) from public;
grant execute on function public.list_driver_cards(uuid[]) to anon, authenticated, service_role;
