-- Approve in-car tablet ad ride bundles ($12 / $25 / $89 / $299) and confirm
-- Option C affiliate partner multipliers (1x student, 1.25x campus group/local business, 1.5x creator).
-- Additive and idempotent.

insert into public.ad_packages (
  id, kind, name, description, price_cents, slot_seconds, frequency,
  placement, duration_days, rides_included, game_day_boost, active, placeholder, sort
)
values
  ('rides-100', 'bundle', '100 rides', 'Ad shown in 100 rides', 1200, 10, 1, 'standard', 120, 100, 1, true, false, 100),
  ('rides-250', 'bundle', '250 rides', 'Ad shown in 250 rides', 2500, 10, 1, 'standard', 120, 250, 1, true, false, 110),
  ('rides-1000', 'bundle', '1,000 rides', 'Ad shown in 1,000 rides', 8900, 10, 1, 'standard', 120, 1000, 1, true, false, 120),
  ('rides-5000', 'bundle', '5,000 rides', 'Ad shown in 5,000 rides', 29900, 10, 1, 'standard', 120, 5000, 1, true, false, 130)
on conflict (id) do update set
  kind = excluded.kind,
  name = excluded.name,
  description = excluded.description,
  price_cents = excluded.price_cents,
  rides_included = excluded.rides_included,
  active = true,
  placeholder = false,
  updated_at = now();

insert into public.affiliate_config (key, value)
values (
  'rates',
  jsonb_build_object(
    'plan', 'option_c',
    'placeholder', false,
    'multipliers_pending_confirmation', false,
    'multipliers_note', 'Confirmed Option C partner bonuses: campus groups 1.25x, local businesses 1.25x, creators 1.5x. Students stay at 1x.',
    'currency', 'usd',
    'rider_first_ride_cents', 400,
    'rider_min_fare_cents', 1500,
    'driver_first_trip_cents', 2000,
    'partner_type_bps', jsonb_build_object('student', 10000, 'campus_org', 12500, 'local_business', 12500, 'influencer', 15000),
    'hold_days', 14,
    'monthly_cap', 50,
    'min_payout_cents', 1000
  )
)
on conflict (key) do update set
  value = public.affiliate_config.value || excluded.value,
  updated_at = now();
