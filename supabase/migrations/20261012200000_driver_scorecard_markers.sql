-- Driver scorecard and cosmetic map markers. Additive: chosen marker on the
-- perks prefs table and admin-editable milestone config. Cosmetic only.
alter table public.driver_perk_prefs add column if not exists map_marker jsonb;

insert into public.driver_perk_config (key, value)
values ('scorecard', jsonb_build_object(
  'enabled', true,
  'windowDays', 30, 'maxOffers', 100,
  'milestones', jsonb_build_array(
    jsonb_build_object('id', 'trips_50',  'metric', 'trips',      'threshold', 50,   'unlocks', jsonb_build_array('color:tiger_orange')),
    jsonb_build_object('id', 'trips_100', 'metric', 'trips',      'threshold', 100,  'unlocks', jsonb_build_array('color:regalia_purple', 'icon:car_sport')),
    jsonb_build_object('id', 'trips_250', 'metric', 'trips',      'threshold', 250,  'unlocks', jsonb_build_array('livery:tiger_stripe', 'icon:paw')),
    jsonb_build_object('id', 'trips_500', 'metric', 'trips',      'threshold', 500,  'unlocks', jsonb_build_array('livery:gold_rush', 'icon:star')),
    jsonb_build_object('id', 'rating_49', 'metric', 'rating',     'threshold', 4.9,  'unlocks', jsonb_build_array('color:midnight', 'icon:sparkles')),
    jsonb_build_object('id', 'completion_95', 'metric', 'completion', 'threshold', 0.95, 'unlocks', jsonb_build_array('livery:checkered'))
  )))
on conflict (key) do nothing;
