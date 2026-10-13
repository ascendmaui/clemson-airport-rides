-- Upfront driver boost on a scheduled ride (distinct from trips.tip_cents).
-- Cap matches shared/scheduledBoost.js BOOST_MAX_CENTS ($100).
-- John: driver split is BOOST_DRIVER_SHARE_BPS (100% to the driver). This
-- column stores the rider amount. Commission is not taken out of it in app code.
-- Do not apply this against the shared production database until that schema
-- change is intended. The app also writes metadata.boost_cents so staging can
-- exercise the boost before this column exists.

alter table public.trips add column if not exists boost_cents integer not null default 0;

alter table public.trips drop constraint if exists trips_boost_cents_range;

alter table public.trips add constraint trips_boost_cents_range
  check (boost_cents >= 0 and boost_cents <= 10000);
