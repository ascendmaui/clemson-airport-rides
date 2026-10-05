# Missed offer rebroadcast

Targeted, immediate `driver_request` rides now have a server-owned 60-second offer window. A database cron calls `GET /api/driver?action=rebroadcast-offers` every minute. Healthy cron delivery advances a missed target roughly 60–120 seconds after assignment, even when both apps are closed. Each run handles the oldest 100 due rides; backlog or a failed run can add latency.

The sweep reuses the existing driver approval and fleet eligibility checks. It skips offline drivers, the rider, explicit passes, and targets already tried in this attempt. It preserves the original queue order, then considers eligible drivers who came online later. Each next target gets a fresh window. When no untried eligible driver remains, the ride returns to the existing open pool, where later arrivals can find it. This fallback retains the existing pool's visibility and acceptance rules; it does not cancel the ride or retry payments.

`offer_expires_at` is maintained by a database trigger. Marking an offer seen or editing unrelated metadata does not extend it. Changing targets resets it; acceptance, cancellation, and release to the pool clear it. Explicit passes record the driver in the attempt history and use the same deadline trigger. Scheduled rides, airport deposit holds, other trip kinds, and already assigned rides are excluded.

The update compares trip status, an empty `driver_id`, the full metadata snapshot, and the exact deadline. An accept, cancel, pass, metadata edit, or overlapping sweep can win; a losing sweep skips the row without overwriting it. Existing web/native realtime subscriptions and polling reload the trip. The rider stays searching until an actual accept; no driver is assigned by a timeout. A stale driver's accept fails when the ride is retargeted to another driver. The sweep records its last reason/time and attempted drivers in metadata in the same atomic update, without a separate event write that could fail after dispatch.

## Rollout

1. Apply `20261004150000_matching_offer_deadline.sql`. Existing eligible targets receive a full 60-second window. This is compatible with existing clients.
2. Deploy the API change. Check that `CRON_SECRET` is configured and matches the existing Vault secret `clemson_cron_secret`. The route requires the bearer secret; a cron header alone is insufficient.
3. Call the route with `dry_run=1` and the bearer header to inspect counts without writes. A missing migration causes a generic 500 rather than an unguarded fallback.
4. Apply `20261004151000_matching_rebroadcast_cron.sql` to enable the minute job using the existing pg_cron/pg_net infrastructure. Inspect `cron.job`, `cron.job_run_details`, and pg_net responses to confirm delivery. Database job success alone does not establish HTTP success.

No deployment or live migration is performed as part of this draft PR. To pause sweeps, run `select cron.unschedule('matching-rebroadcast');` in the deployment environment. Existing acceptance still works with the deadline column/trigger present.

## Verify

- Run `node --test server/matchingRebroadcast.test.js server/matchingRebroadcastSql.test.js server/weekendDrive.test.js tests/matchingE2E.test.js shared/driverOrder.test.js`, then `npm test` and `npm run build`.
- In a test environment with two approved online drivers, request an immediate campus ride. Leave the first target's card unseen, then repeat with it seen but ignored. After its window and the next cron tick, only the next target should see the targeted offer. The rider should still be searching with no assigned driver.
- Try the old card's Accept while the next driver accepts. Exactly one claim may win. If the first accept commits before timeout, the sweep leaves it alone; otherwise the stale target is rejected. The rider and winning driver should both show the same accepted trip.
- Cancel during the window, or race two authenticated sweep requests. A canceled ride must stay canceled, and overlapping sweeps must not skip a target.
- Take the next driver offline, pass an offer, or bring another eligible driver online after the request. Confirm the next timeout skips offline/passed/tried drivers and can discover the new driver. Exhaust the targets and confirm release to the open pool.
- Confirm targeted Comfort waves choose Comfort-listed drivers. Confirm scheduled rides and deposit holds are untouched. Check response counts (`scanned`, `advanced`, `released`, `skipped`, `errors`, `wouldAdvance`); per-trip failures remain due for a later retry and produce HTTP 500 with counts.
