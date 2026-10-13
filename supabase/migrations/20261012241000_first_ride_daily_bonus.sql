-- First ride of the day. Additive seed only.
-- driver_perk_config and driver_bonus_ledger already exist
-- (20261012130000_driver_perks_ledger_streaks). startsAt is now() so
-- trips completed before this ships never pay.

insert into public.driver_perk_config (key, value)
values ('first_ride_daily', jsonb_build_object(
  'enabled', true,
  'startsAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'bonusCents', 500))
on conflict (key) do nothing;
