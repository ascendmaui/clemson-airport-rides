-- Payouts hold (2026-10-17). Clemson Rides launches with driver payouts held
-- until the Stripe payout bank account exists. Additive and reversible.
--
-- public.payout_controls is a single-row kill switch read by
-- server/payoutHold.js. payouts_enabled = false: no Stripe transfer or payout
-- to a driver runs (trip payouts, tips, wait/cancel/switch/standby fees,
-- bonuses, instant/standard cash-out, approval executions). Earnings keep
-- accruing as 'pending' in driver_payouts / backup_driver_payouts /
-- driver_bonus_ledger and trips.metadata.payout.
-- Re-enable: see docs/PAYOUTS_HOLD.md.

create table if not exists public.payout_controls (
  id smallint primary key default 1 check (id = 1),
  payouts_enabled boolean not null default false,
  hold_reason text,
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table public.payout_controls enable row level security;
revoke all on table public.payout_controls from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on table public.payout_controls from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on table public.payout_controls from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update on table public.payout_controls to service_role;
  end if;
end $$;

insert into public.payout_controls (id, payouts_enabled, hold_reason, updated_by)
values (1, false, 'Held until the Clemson Rides Stripe payout bank account is added (John, 2026-10-17)', 'payouts-hold migration')
on conflict (id) do nothing;

-- Pause (do not drop) the daily 12:00 UTC driver-payouts sweep.
do $$
declare
  v_job bigint;
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    select jobid into v_job from cron.job where jobname = 'driver-payouts' limit 1;
    if v_job is not null then
      perform cron.alter_job(job_id := v_job, active := false);
    end if;
  end if;
end $$;
