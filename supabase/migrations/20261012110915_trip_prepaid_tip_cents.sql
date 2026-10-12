-- Tip boost chosen at booking (distinct from the post-trip trips.tip_cents).
-- Held with the fare, captured with it, released with the hold on cancel.
-- 100% goes to the driver (shared/prepaidTip.js PREPAID_TIP_DRIVER_SHARE_BPS).
-- Additive only. Applied to prod (awktabuhijrshmsmagpq) 2026-10-12 as version 20261012110915. Cap matches PREPAID_TIP_MAX_CENTS ($100).

alter table public.trips add column if not exists prepaid_tip_cents integer not null default 0;

alter table public.trips drop constraint if exists trips_prepaid_tip_cents_range;

alter table public.trips add constraint trips_prepaid_tip_cents_range
  check (prepaid_tip_cents >= 0 and prepaid_tip_cents <= 10000);
