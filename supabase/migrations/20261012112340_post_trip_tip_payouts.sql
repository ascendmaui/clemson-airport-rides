-- Post-trip tips go 100% to the driver as their own transfer (server/payouts.js attemptTipPayout).
-- Additive + idempotent:
--   1. Allow role 'tip' in the per-trip extra payout ledger (superset of the old check).
--   2. Backfill a pending ledger row for every real (non-e2e) completed trip with an
--      unpaid post-trip tip. No money moves here; the daily driver-payouts sweep transfers it.
--      E2E/test trips are excluded. Re-running inserts nothing new (on conflict do nothing).
-- As of 2026-10-12 prod has 0 qualifying real trips (35 e2e-only tips, $35.00, skipped).

alter table public.backup_driver_payouts drop constraint if exists backup_driver_payouts_role_known;
alter table public.backup_driver_payouts add constraint backup_driver_payouts_role_known
  check (role = any (array['standby'::text, 'switch_fee'::text, 'cancel_fee'::text, 'tip'::text]));

insert into public.backup_driver_payouts (trip_id, driver_id, role, amount_cents, status, attempts, updated_at)
select t.id, t.driver_id, 'tip', t.tip_cents, 'pending', 0, now()
from public.trips t
where t.status = 'completed'
  and t.driver_id is not null
  and coalesce(t.tip_cents, 0) > 0
  and coalesce((t.metadata->>'e2e_test')::boolean, false) = false
  and coalesce((t.metadata->>'tip_refunded')::boolean, false) = false
  and coalesce(t.metadata->'tip_payout'->>'status', '') <> 'paid'
on conflict (trip_id, role) do nothing;
