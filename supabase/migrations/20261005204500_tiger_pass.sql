-- Frequent-rider pass. The rider-facing name lives in shared/tigerPass.js
-- (TIGER_PASS_NAME). This table stores status, discount, and preferences.
-- Favorite drivers stay on profiles.favorite_driver_ids.
-- Preferred drivers are a subset used first while the pass is active.
-- Preferred ride types are only standard, wait, and comfort.

create table if not exists public.rider_subscriptions (
  rider_id uuid primary key references public.profiles(id) on delete cascade,
  product_id text not null default 'tiger_pass',
  status text not null default 'inactive',
  discount_bps integer not null default 1000,
  preferred_driver_ids jsonb not null default '[]'::jsonb,
  preferred_car_types jsonb not null default '[]'::jsonb,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_checkout_session_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rider_subscriptions_status_check
    check (status in ('inactive', 'active', 'past_due', 'canceled')),
  constraint rider_subscriptions_discount_bps_check
    check (discount_bps >= 0 and discount_bps <= 5000)
);

comment on table public.rider_subscriptions is
  'Frequent-rider pass. Display name is the TIGER_PASS_NAME rename hook, not a column.';

comment on column public.rider_subscriptions.preferred_driver_ids is
  'Subset of favorite drivers offered first while the pass is active. Preview cars are not stored.';

comment on column public.rider_subscriptions.preferred_car_types is
  'Offered ride types the rider prefers: standard, wait, comfort.';

create index if not exists rider_subscriptions_stripe_subscription_idx
  on public.rider_subscriptions (stripe_subscription_id)
  where stripe_subscription_id is not null;

alter table public.rider_subscriptions enable row level security;

drop policy if exists rider_subscriptions_select_own on public.rider_subscriptions;
create policy rider_subscriptions_select_own
  on public.rider_subscriptions
  for select
  to authenticated
  using (auth.uid() = rider_id);

grant select on public.rider_subscriptions to authenticated;
