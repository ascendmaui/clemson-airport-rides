-- Late-night party-ride queue (College Ave). Additive: opt-in columns on the
-- perks prefs table and an admin-editable config row.
alter table public.driver_perk_prefs add column if not exists party_queue_opt_in boolean not null default false;
alter table public.driver_perk_prefs add column if not exists party_queue_joined_at timestamptz;

insert into public.driver_perk_config (key, value)
values ('party_queue', jsonb_build_object(
  'enabled', true,
  'label', 'College Ave',
  'lat', 34.6834, 'lng', -82.8374, 'radiusKm', 0.6,
  'startHour', 22, 'endHour', 3,
  'days', jsonb_build_array(4, 5, 6),
  'boost', 2))
on conflict (key) do nothing;
