-- Saved drivers a rider can request again from Pick a driver.
-- The apps also keep a phone copy when this column is not applied yet.
-- Offline favorites are listed but cannot be requested, and a decline does not auto-match.

alter table public.profiles
  add column if not exists favorite_driver_ids jsonb not null default '[]'::jsonb;

comment on column public.profiles.favorite_driver_ids is
  'Driver profile ids the rider saved. A preferred request stays with that driver and is canceled if they decline.';
