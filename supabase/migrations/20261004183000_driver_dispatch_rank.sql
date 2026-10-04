-- Picker cards gain a house dispatch rank without exposing driver email.
-- 0 = johnmatveyev@gmail.com, 1 = kimubermaui@gmail.com, 2 = everyone else.

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
  is_tesla boolean,
  dispatch_rank integer
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
    v.is_tesla,
    case lower(btrim(coalesce(p.email, '')))
      when 'johnmatveyev@gmail.com' then 0
      when 'kimubermaui@gmail.com' then 1
      else 2
    end as dispatch_rank
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
