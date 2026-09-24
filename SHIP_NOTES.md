# Ride with friends + Carpool — ship notes

## Payments (failure handling)
- Canonical collector: `collectPayment({ tripId, amountCents, methods: ['credits','card'] })` in `server/collectPayment.js` (re-exported from `server/friendRideLib.js`).
- 20% platform fee only: `shared/platformFee.js`. Wait-time and mid-ride cancel fees stay with their owners — pass `amountCents` or write `metadata.wait_fee_cents` / `metadata.cancel_fee_cents`. Do not fork that math.
- Trip complete/cancel that costs money goes through `POST /api/trip-settle`. `$0` proceeds. Otherwise status stays put and `metadata.payment_hold.status` is `payment_required`.
- Driver payout failures stay `metadata.payout.status = pending` and retry with backoff (`POST /api/driver-payouts`, cron when `CRON_SECRET` is set).
- Unpaid airport-deposit searching/offered/scheduled holds leave the pool 20 minutes after `created_at` or Checkout session bind (`metadata.stripe_checkout_created_at`, whichever is later). `GET /api/expire-unpaid-airport-holds` writes the same `trip_events` cancel and `checkout_abandoned` stamp as Checkout abandon, so a later paid deposit still restores the trip. Paid deposits, `deposit_cents = 0`, and non-airport trips are skipped. No new secret: reuse `CRON_SECRET` when it is set, otherwise Vercel’s `x-vercel-cron: 1` header. Hobby cron is daily, so add this on a plan that allows a 15-minute schedule: `{ "path": "/api/expire-unpaid-airport-holds", "schedule": "*/15 * * * *" }`.

## Payments (FINAL LOCK)
- SetupIntent save card (off_session)
- Organizer Confirm → off_session PI OR Payment Element / Apple Pay
- Full share; partial fail → retry; book only when all paid
- Do **not** invent Checkout pay-links for carpool (same as friends)

## Product — friends
1. /friends/:token (+ hash redirect)
2. Max 5; Routes optimize; automatic fare + surge
3. Fare split preview UI before charge
4. ride_bills itemized receipts
5. Ratings both sides; soft remind / skip
6. Multi-stop live tracking on Requested

## Product — carpool flagship

See `docs/CARPOOL_MATCHING.md` for the matching algorithm, the $30–$40 vs $10–$15 split, driver bonus id `driver_carpool_bonus`, and how this extends friend rides instead of forking them.

## Product — carpool (kind=carpool)
1. Organizer (student-with-car) creates → shareable `/carpool/:token`
2. Also accept `/friends/:token?kind=carpool`
3. Hash redirect: `#/carpool/:token` → `/carpool/:token`
4. Riders join with pickup/dropoff (max 5); reuse friend-ride APIs
5. Google Routes + even/by_distance + automatic fare (friendRideLib)
6. Charge: saved card off_session OR Apple Pay / Payment Element
7. All paid → one trips row; `driver_id` = organizer (skip open matching → status accepted)
8. Trust UI: "Clemson student" badge when `student_verified_at`; show ratings
9. Entry: Marketing / Friends / Account / DriverHome "Offer a carpool"

## Mid-ride cancel
- Status `canceled_midride` after pickup (`in_progress`, or `arriving` only if the trip already started). Pickup wait-fee cancel is a different flow.
- Obligation = min(quoted fare, max(meter, progress × quoted)) + cancel fee ($5 default, `MIDRIDE_CANCEL_FEE_CENTS`).
- Meter = $2.50 + $1.75/mi + $0.35/min. Progress = max(GPS distance / straight-line trip, elapsed / expected at 30 mph).
- Platform 20% / driver 80% of the obligation. Succeeded deposits reduce the new card charge only.
- Blocked after 3 mid-ride cancels in 30 days (`MIDRIDE_CANCEL_MAX`, `MIDRIDE_CANCEL_WINDOW_DAYS`).
- API: `POST /api/trip-cancel-midride` (`confirm: true` charges; omit confirm to preview).
- Card collection goes through `server/collectPayment.js` when that module is present. A decline still ends the trip and surfaces `payment_required` (toast + trip event). The trip is not left in progress.

## Payment kinds
Held SQL files each replace `payments_kind_check`. Apply `supabase/payments_kind_union.sql` last so tip, wait, cancel, mid-ride, and both credit purchase kinds can be inserted together.

## Env / blockers
- GOOGLE_MAPS_API_KEY (Vercel server Routes)
- VITE_GOOGLE_MAPS_API_KEY billed (Maps / CampusMap)
- Apple Pay domain in Stripe Dashboard
- sendmaui Maps billing if CampusMap blanks
