-- Game-day surge for drivers (zones from game_day_events + config zones).
-- Driver bonus is paid from config into driver_bonus_ledger; rider fares unchanged. Additive.
insert into public.driver_perk_config (key, value)
values ('game_day_surge', jsonb_build_object(
  'enabled', true,
  'startsAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'radiusKm', 1.5, 'driverBonusCents', 300, 'zoneBoost', 1, 'leadHours', 36,
  'zones', '[]'::jsonb))
on conflict (key) do nothing;
