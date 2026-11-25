# Payouts hold

Clemson Rides launched on 2026-10-17 with **driver payouts on hold** until
John adds the payout bank account on the live Stripe account
(`acct_1UJ7jlPLOS9L2qRg`). Rides, quotes, and charges work normally. Drivers
still earn 80% of each fare; it just doesn't leave the platform yet.

## What is held

| Path | Where | Held by |
|---|---|---|
| Daily payouts sweep (pg_cron `driver-payouts`, job id 4, `0 12 * * *` = 8 AM ET) | `private.trigger_driver_payouts()` -> `GET /api/driver-payouts` | cron job set `active = false`; the endpoint also returns `{ held: true }` and moves nothing |
| Trip payout on completion, wait-cancel, standby, cancel-fee, switch-fee, tip transfers | `server/payouts.js` `attemptDriverPayout` (called from `tripSettle`, `tripWait`, `waitFeeChargeSweep`, `backupRiderActions`, sweep) | `payoutsHeld()` check before any Stripe call |
| Driver bonuses (streak, first ride, referral, surge) | `server/perks.js` `payBonusLedger` | returns early, ledger rows stay `pending` |
| Instant / standard cash-out buttons | `server/cashout.js` `cashoutQuote` / `executeCashout` / `completeApprovedCashout` | quote state `payouts_on_hold`; execute returns 409 before any claim |
| Driver "retry payouts" POST | `server/endpoints/driverPayouts.js` | returns `{ held: true }` |
| Admin approving a payout request | `server/endpoints/payoutApprovals.js` | approve returns 409 `payouts_on_hold` (reject still works) |

Affiliate Connect transfers (`server/affiliateConnect.js`) already refuse to
run with a live key and are not part of this hold.

## The switch

`public.payout_controls` (single row, `id = 1`), created by migration
`20261017220800_payouts_hold.sql`:

- `payouts_enabled = false` -> held (current state).
- `PAYOUTS_HOLD=1` in the VPS env forces a hold even if the row says enabled.
- If the row can't be read and the Stripe key is live, the server treats
  payouts as held (fails closed).

Logic: `server/payoutHold.js` (`payoutsHeld`). Driver copy:
`shared/payoutHold.js`, `CASHOUT_COPY.payouts_on_hold`.

## Where held earnings accumulate

Nothing is lost. Held payouts stay `status = 'pending'` with
`last_error = 'payouts_on_hold'`, no attempt counted, no retry timer:

- `public.driver_payouts` (one row per trip) and `trips.metadata.payout`
- `public.backup_driver_payouts` (tips, standby, cancel and switch fees) and
  `trips.metadata.tip_payout` / `backup_*_payout`
- `public.driver_bonus_ledger` (bonuses, `status = 'pending'`)

Drivers see these as **pending payout** in the earnings and payouts screens
(the hold code is hidden from them).

Total owed while held:

```sql
select status, count(*), sum(amount_cents) / 100.0 as usd
from public.driver_payouts group by status;
select role, status, count(*), sum(amount_cents) / 100.0 as usd
from public.backup_driver_payouts group by role, status;
select status, count(*), sum(amount_cents) / 100.0 as usd
from public.driver_bonus_ledger group by status;
```

## Re-enable (after John adds the bank account)

1. In the Stripe dashboard for `acct_1UJ7jlPLOS9L2qRg`, confirm the payout
   bank account shows as verified and the platform balance can fund transfers.
2. Flip the switch (Supabase SQL editor or MCP `execute_sql`, project
   `awktabuhijrshmsmagpq`):

   ```sql
   update public.payout_controls
   set payouts_enabled = true,
       hold_reason = null,
       updated_by = 'john',
       updated_at = now()
   where id = 1;
   ```

3. Resume the daily sweep (job keeps its `0 12 * * *` schedule):

   ```sql
   select cron.alter_job(
     job_id := (select jobid from cron.job where jobname = 'driver-payouts'),
     active := true
   );
   select jobid, jobname, schedule, active from cron.job where jobname = 'driver-payouts';
   ```

4. Make sure `PAYOUTS_HOLD` is unset or `0` in `/opt/clemson-rides/.env` on
   the VPS (the hold does not rely on it; it only forces a hold).
5. Optional dry run first (no Stripe calls, no writes):
   `GET https://clemsonrides.com/api/driver-payouts?dry_run=1` with the cron
   bearer. Needs `ALLOW_STAGING_DRY_RUN=1` on the server.
6. With a live key every transfer still goes through the payout approval
   queue (johnmatveyev@gmail.com approves). The first sweep after re-enable
   creates approval requests for the backlog. Instant cash-out with a live key
   also still needs `CASHOUT_LIVE_ENABLED=1`.

To put the hold back: set `payouts_enabled = false` and pause the job with
`active := false`.
