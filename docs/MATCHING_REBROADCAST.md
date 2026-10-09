# Missed offer ladder

The first targeted offer is exclusive for 15 seconds at an 80% driver share. When that window ends, the ride opens to every eligible online driver at 70% for two minutes, then expires. Scheduled rides stay on their own driver-app tab at 75% and are not part of this sweep. A database trigger owns the deadlines (`20261005203000_offer_ladder_windows.sql`, replacing the 60-second window in `20261004150000_matching_offer_deadline.sql`).

A database cron calls `GET /api/driver?action=rebroadcast-offers` every minute. The sweep moves a due exclusive offer into the pool and cancels a due pool offer. Because that job is minute-resolution, a missed exclusive offer opens the pool on the next tick after `offer_expires_at` (within about a minute of the 15-second mark, not on a sub-minute timer). The driver card stays on screen through that gap. Each run handles the oldest 100 due rides.

The pool alert goes to eligible online drivers and skips the rider and anyone who already passed. Explicit decline still uses the existing pass path and can advance to another driver before the exclusive window ends. A timeout does not walk the driver list one by one.

`offer_expires_at` is maintained by the trigger. Marking an offer seen or editing unrelated metadata does not extend it. Entering the pool sets a fresh two-minute deadline. Acceptance and cancellation clear it. Scheduled rides, airport deposit holds, other trip kinds, and already assigned rides are excluded.

The update compares trip status, an empty `driver_id`, the full metadata snapshot, and the exact deadline. An accept, cancel, pass, metadata edit, or overlapping sweep can win; a losing sweep skips the row without overwriting it. The rider stays searching until an actual accept. The sweep records its reason, time, and attempted drivers in metadata in the same atomic update.

## Rollout

1. Apply `20261004150000_matching_offer_deadline.sql`, then `20261005203000_offer_ladder_windows.sql`. New exclusive targets receive a 15-second window. Pool phase receives two minutes.
2. Deploy the API change. Check that `CRON_SECRET` is configured and matches the existing Vault secret `clemson_cron_secret`. The route requires the bearer secret; a cron header alone is insufficient.
3. Call the route with `dry_run=1` and the bearer header to inspect counts without writes. A missing migration causes a generic 500 rather than an unguarded fallback.
4. Apply `20261004151000_matching_rebroadcast_cron.sql` if the minute job is not already enabled. Inspect `cron.job`, `cron.job_run_details`, and pg_net responses to confirm delivery. Database job success alone does not establish HTTP success.

No deployment or live migration is performed as part of this change. To pause sweeps, run `select cron.unschedule('matching-rebroadcast');` in the deployment environment.

## Verify

- Run `node --test server/matchingRebroadcast.test.js server/matchingRebroadcastSql.test.js server/offerLadderSql.test.js server/weekendDrive.test.js tests/matchingE2E.test.js shared/driverOrder.test.js`, then `npm test` and `npm run build`.
- In a test environment with two approved online drivers, request an immediate campus ride. Leave the first target's card unseen. After its 15-second deadline and the next cron tick, both eligible drivers should see the 70% pool offer. The rider should still be searching with no assigned driver.
- Accept during the exclusive window. The sweep must leave that row alone. Exactly one claim may win.
- Cancel during the window, or race two authenticated sweep requests. A canceled ride must stay canceled.
- Pass an offer, or take a driver offline. The pool alert skips that driver. After the two-minute pool deadline, the ride is canceled with `offer_expired`.
- Confirm scheduled rides and deposit holds are untouched. Check response counts (`scanned`, `advanced`, `pooled`, `released`, `expired`, `skipped`, `errors`, `wouldAdvance`, `wouldPool`, `wouldExpire`).
