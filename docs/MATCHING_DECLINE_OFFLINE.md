# Decline and offline offer release

For immediate, zero-deposit `driver_request` rides, inserting/updating a driver's existing `driver_offer_passes` record releases that driver's targeted offer in the same transaction. Web uses the pass API; native uses the existing pass-table write. Changes to `driver_status.online` to false/null, and deletion of a presence row, release that driver's outstanding targets through the same database function. Accepted assignments are never released by these triggers.

The next candidate is online and approved (or has existing database staff/admin access), is not the rider, has not passed or already been tried, and satisfies the existing Comfort fleet criteria when applicable. Original queue order comes first, then other eligible online drivers in default dispatch order. Locked presence rows are skipped to avoid waiting on another presence transition. With no candidate, the ride returns to the open pool. The rider stays searching, with no assigned driver, until acceptance. Existing realtime subscriptions and polling observe the trip update; passed drivers are excluded by pass records and dispatch metadata.

A trip row lock serializes release against acceptance and cancellation. Accept checks the current target, pass exclusions, and online presence at the database boundary. It locks presence with NOWAIT to avoid the inverse lock order used by offline updates; a conflicting accept fails and must refresh/retry. Release failure rolls back the initiating pass/offline write. Repeat or stale passes cannot move another driver's target. Helpers are security-definer functions with fixed search paths and no public execution grants; existing pass/presence RLS remains in force.

## Rollout

Apply `supabase/migrations/20261004160000_matching_decline_offline.sql` through the normal reviewed migration process before deploying these API/client changes. It depends on the existing trips, presence, pass, approval, vehicle, profiles and admin directory tables. No migration or deployment was executed during this change. Older clients' pass and offline writes also reach the triggers.

This is independent of draft #288 and has no cron/deadline migration. It preserves unrelated metadata and records released drivers in `offer_tried_driver_ids`, which that draft already consumes. Its deadline trigger can reset the next target's window when combined. Resolve the small shared pass-handler edit if both PRs land. Do not apply the timeout draft as a prerequisite.

Only persisted availability changes trigger this pass. Closing an app or losing network without an offline write needs timeout recovery. Custom API-only support email environment overrides are not database candidate grants; staff should have their existing database role/directory entry. No new approval requirements apply to approved drivers.

## Verify in a test environment

1. Put two approved standard drivers online. Request an immediate ride targeted to A. Pass from web, then repeat from native. B should receive the offer immediately; A's card disappears and the rider remains searching.
2. Repeat with A unseen/searching and seen/offered; set A offline or remove A's presence. Verify B receives it. If no candidates remain, verify an eligible new driver can see and accept the open-pool ride.
3. Double-pass A and attempt acceptance from A's stale card. Verify B's target remains intact. Race A's acceptance against offline/pass: either its committed acceptance survives or the stale accept fails. Race cancellation too; there must be only one assigned driver and no resurrection of terminal trips.
4. Confirm offline, unapproved, rider-self, previously passed/tried and incompatible Comfort candidates are skipped. Check that scheduled/deposit rides are unchanged.
5. Inject a database update error in a disposable environment. Verify the pass/offline write fails and the client reports the error instead of claiming success.

Automated coverage: PGlite executes the actual migration and both serial race outcomes, stale compare-and-set acceptance, migration reapplication, failure rollback, fleet/approval selection, pass retries, offline/deletion, and exhaustion. API/native tests cover persistence errors and avoiding a second client rewrite. True concurrent PostgreSQL sessions and live multi-device realtime delivery still need the manual checks above.

To disable the release behavior, remove `matching_offer_passed` from `driver_offer_passes` and `matching_driver_offline` from `driver_status` through a reviewed migration; retain `trips_guard_matching_accept` to keep stale accepts blocked. Existing searching targets then need manual retargeting or timeout recovery.
