-- DO NOT APPLY until John approves.
-- Columns the server already reads/writes but that are missing in production
-- (confirmed via information_schema on awktabuhijrshmsmagpq, 2026-09-24 10:05 PM ET):
--   * profiles.stripe_card_brand / stripe_card_last4: setup-intent returns
--     schemaNote "column profiles.stripe_card_brand does not exist" and never stores the saved card label.
--   * trips.created_at: create-checkout-session logs
--     "session bind column trips.created_at does not exist"; server/abandonedCheckout.js
--     selects/filters/orders on it for the unpaid-hold expiry.

alter table public.profiles add column if not exists stripe_card_brand text;
alter table public.profiles add column if not exists stripe_card_last4 text;

-- Add nullable first, backfill existing rows from requested_at so old holds keep
-- their real age (a plain "default now()" would stamp every existing trip as new),
-- then set the default and NOT NULL.
alter table public.trips add column if not exists created_at timestamptz;
update public.trips set created_at = coalesce(requested_at, scheduled_for, now()) where created_at is null;
alter table public.trips alter column created_at set default now();
alter table public.trips alter column created_at set not null;
create index if not exists trips_created_at_idx on public.trips (created_at);
