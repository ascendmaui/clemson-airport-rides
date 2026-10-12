-- Driver-to-driver referrals. Separate from rider referrals (public.referrals).
-- Additive only. Bonus money is recorded in driver_bonus_ledger (kind referral).

create table if not exists public.driver_referral_codes (
  driver_id uuid primary key,
  code text not null unique check (code ~ '^[A-Z0-9]{4,16}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.driver_referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null,
  referee_id uuid not null unique,
  code text not null,
  status text not null default 'pending' check (status in ('pending', 'qualified', 'void')),
  qualified_at timestamptz,
  created_at timestamptz not null default now(),
  check (referrer_id <> referee_id)
);
create index if not exists driver_referrals_referrer on public.driver_referrals (referrer_id);

alter table public.driver_referral_codes enable row level security;
alter table public.driver_referrals enable row level security;
drop policy if exists driver_referral_codes_own on public.driver_referral_codes;
create policy driver_referral_codes_own on public.driver_referral_codes
  for select to authenticated using (driver_id = auth.uid());
drop policy if exists driver_referrals_party on public.driver_referrals;
create policy driver_referrals_party on public.driver_referrals
  for select to authenticated using (referrer_id = auth.uid() or referee_id = auth.uid() or public.is_admin());
revoke all on public.driver_referral_codes, public.driver_referrals from public, anon;
grant select on public.driver_referral_codes, public.driver_referrals to authenticated;
grant all on public.driver_referral_codes, public.driver_referrals to service_role;

insert into public.driver_perk_config (key, value)
values ('referral', jsonb_build_object('enabled', true, 'targetTrips', 10, 'bonusCents', 5000, 'shareBaseUrl', 'https://clemsonrides.com/drive'))
on conflict (key) do nothing;
