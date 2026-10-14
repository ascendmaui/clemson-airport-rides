-- Clemson Rides student plans (Weekend Carpool Plan + personalized plan).
-- ADDITIVE ONLY: new tables, indexes, RLS, and seed rows. Nothing existing is
-- altered or dropped. Feature is OFF until STUDENT_PLANS_ENABLED is set (or a
-- rider is on STUDENT_PLANS_ALLOW_EMAILS). Stripe Price IDs are NOT stored here
-- as secrets; they are read from env/config (see shared/studentPlans.js).

create table if not exists public.subscription_plans (
  id text primary key,
  name text not null,
  monthly_cents integer,
  semester_cents integer,
  four_year_anchor_cents integer,
  billed_months_per_year integer not null default 8,
  config jsonb not null default '{}'::jsonb,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.subscription_plans (id, name, monthly_cents, semester_cents, four_year_anchor_cents, billed_months_per_year, config, active)
values
  ('weekend_carpool', 'Weekend Carpool Plan', 8900, 34900, 299900, 8,
   '{"min_riders":2,"nights":[5,6],"window_start_hour":18,"window_end_hour":4,"surge_cap_bps":12000,"driver_share_bps":8000}'::jsonb, false),
  ('personalized', 'Your Clemson Rides Plan', null, null, null, 8,
   '{"monthly_discount_bps":1000,"semester_discount_bps":1500,"min_margin_bps":1500,"driver_share_bps":8000}'::jsonb, false)
on conflict (id) do nothing;

create table if not exists public.plan_quotes (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.profiles(id) on delete cascade,
  pattern text not null,
  metrics jsonb not null default '{}'::jsonb,
  quoted_plan text,
  recommendation text not null,
  monthly_cents integer,
  semester_cents integer,
  retail_monthly_cents integer not null default 0,
  floor_cents integer not null default 0,
  savings_cents integer not null default 0,
  summary text,
  email_status text not null default 'preview',
  email_preview jsonb,
  unsubscribe_token text not null default replace(gen_random_uuid()::text, '-', ''),
  expires_at timestamptz not null,
  price_locked_until timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint plan_quotes_email_status_check check (email_status in ('preview', 'queued', 'sent', 'skipped', 'failed'))
);
create unique index if not exists plan_quotes_one_per_rider on public.plan_quotes (rider_id);
create unique index if not exists plan_quotes_unsubscribe_token on public.plan_quotes (unsubscribe_token);

create table if not exists public.student_plan_email_optouts (
  rider_id uuid primary key references public.profiles(id) on delete cascade,
  source text not null default 'unsubscribe_link',
  created_at timestamptz not null default now()
);

create table if not exists public.student_enrollments (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  email_verified_at timestamptz,
  method text not null default 'manual',
  vendor_ref text,
  status text not null default 'pending',
  term_code text not null,
  verified_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  next_check_at timestamptz,
  raw_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_enrollments_method_check check (method in ('manual', 'nsc', 'sheerid', 'id_photo')),
  constraint student_enrollments_status_check check (status in ('pending', 'verified', 'not_enrolled', 'graduated', 'withdrawn', 'failed'))
);
create unique index if not exists student_enrollments_rider_term on public.student_enrollments (rider_id, term_code);

create table if not exists public.student_email_otps (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.profiles(id) on delete cascade,
  email text not null,
  code_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists student_email_otps_rider on public.student_email_otps (rider_id, created_at desc);

create table if not exists public.student_plan_subscriptions (
  rider_id uuid primary key references public.profiles(id) on delete cascade,
  plan_id text not null references public.subscription_plans(id),
  billing_interval text not null,
  status text not null default 'pending',
  quote_id uuid references public.plan_quotes(id) on delete set null,
  price_cents integer,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id text,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  trial_used_at timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  window_start timestamptz,
  active_days_used integer not null default 0,
  paused_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint student_plan_subscriptions_interval_check check (billing_interval in ('month', 'semester')),
  constraint student_plan_subscriptions_status_check
    check (status in ('pending', 'trialing', 'active', 'paused', 'past_due', 'canceled'))
);
create index if not exists student_plan_subscriptions_stripe_idx
  on public.student_plan_subscriptions (stripe_subscription_id) where stripe_subscription_id is not null;

create table if not exists public.subscription_pauses (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  start_date date not null,
  end_date date not null,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint subscription_pauses_kind_check
    check (kind in ('fall_break', 'winter_break', 'spring_break', 'exams', 'leave_of_absence')),
  constraint subscription_pauses_range_check check (start_date <= end_date)
);
create index if not exists subscription_pauses_rider on public.subscription_pauses (rider_id, start_date);

-- One reward per referred student. Credits go through apply_credit_delta
-- (existing credit system); this row is the idempotency anchor.
create table if not exists public.student_plan_referral_rewards (
  referred_id uuid primary key references public.profiles(id) on delete cascade,
  referrer_id uuid not null references public.profiles(id) on delete cascade,
  reward_cents integer not null,
  stripe_subscription_id text,
  created_at timestamptz not null default now()
);

alter table public.subscription_plans enable row level security;
alter table public.plan_quotes enable row level security;
alter table public.student_plan_email_optouts enable row level security;
alter table public.student_enrollments enable row level security;
alter table public.student_email_otps enable row level security;
alter table public.student_plan_subscriptions enable row level security;
alter table public.subscription_pauses enable row level security;
alter table public.student_plan_referral_rewards enable row level security;

drop policy if exists subscription_plans_read on public.subscription_plans;
create policy subscription_plans_read on public.subscription_plans for select to authenticated using (true);
drop policy if exists plan_quotes_select_own on public.plan_quotes;
create policy plan_quotes_select_own on public.plan_quotes for select to authenticated using (auth.uid() = rider_id);
drop policy if exists student_enrollments_select_own on public.student_enrollments;
create policy student_enrollments_select_own on public.student_enrollments for select to authenticated using (auth.uid() = rider_id);
drop policy if exists student_plan_subscriptions_select_own on public.student_plan_subscriptions;
create policy student_plan_subscriptions_select_own on public.student_plan_subscriptions for select to authenticated using (auth.uid() = rider_id);
drop policy if exists subscription_pauses_select_own on public.subscription_pauses;
create policy subscription_pauses_select_own on public.subscription_pauses for select to authenticated using (auth.uid() = rider_id);

grant select on public.subscription_plans, public.plan_quotes, public.student_enrollments,
  public.student_plan_subscriptions, public.subscription_pauses to authenticated;
-- student_email_otps, student_plan_email_optouts, student_plan_referral_rewards: service role only.
