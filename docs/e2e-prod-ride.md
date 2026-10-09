# Production ride E2E harness

`scripts/e2e-prod-ride.mjs` drives one short Standard ride from Cooper Library to
Clemson Downtown through the deployed HTTP API and separate Supabase rider and
driver sessions. It uses the real `driverDesk` acceptance and advancement helpers,
including locked offer economics, live driver tracking, arrival, settlement, capture,
a rider receipt, a positive tip, mutual five-star ratings, and a positive payout
ledger check. Each step has a 30-second HTTP deadline; reads retry
up to three times for eventual consistency. It prints `STEP <name> PASS|FAIL|SKIP`
lines and ends with a JSON summary. Any failure exits nonzero and runs cleanup.

## Configuration

Use Node 22 or newer with the repository dependencies installed. Set these env
variables, or put literal `KEY=VALUE` lines in `~/.config/clemson-e2e/env`:

| Variable | Value |
| --- | --- |
| `E2E_BASE_URL` | Deployed API origin; defaults to `https://clemsonrides.com` |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase public anon key (never a service role key) |
| `STRIPE_PUBLISHABLE_KEY` | Stripe publishable key for the deployed server's mode |
| `E2E_RIDER_EMAIL` | Reserved account, e.g. `e2e+rider@clemsonrides.com` |
| `E2E_RIDER_PASSWORD` | Test rider password |
| `E2E_DRIVER_EMAIL` | Reserved account, e.g. `e2e+driver@clemsonrides.com` |
| `E2E_DRIVER_PASSWORD` | Test driver password |

`E2E_ENV_FILE` selects another file. Exported environment variables take precedence
over file values. The parser accepts optional `export`, single/double quotes and
comments; it does not expand shell variables or execute anything. Keep credentials
outside the repository and restrict the file to your user (e.g. mode `600`). The
script prints neither passwords nor tokens nor keys, only the Stripe key prefix.

The two accounts must already exist. The driver must be approved to go online and
accept rides, and the profiles must have the reserved emails. Set trusted auth
`app_metadata.e2e_test = true` as well. Deploy the isolation changes before running:
test riders match only test drivers, explicit mixed-account picks return 409,
test trips carry `metadata.e2e_test = true`, matching rebroadcast skips those trips,
and the daily payout batch skips their primary and extra payouts. Demo cars remain
ineligible. The harness verifies the trip flag before accepting.

## Run and money safety

```sh
node scripts/e2e-prod-ride.mjs --confirm-prod-e2e
node scripts/e2e-prod-ride.mjs --confirm-prod-e2e --dry-check
node scripts/e2e-prod-ride.mjs --confirm-prod-e2e --continue-without-hold
```

All runs require the confirmation flag and both reserved email addresses.
Dry check only signs in and checks Stripe mode; it creates a SetupIntent but does
not confirm a card, change driver presence, or book.

The harness retrieves the SetupIntent with the supplied publishable key. A live
key, `livemode: true`, failed retrieval/key mismatch, or missing mode is treated as
live. It then prints `STEP book SKIP live Stripe: refusing to place a real hold`
and exits successfully with capture/payout explicitly unexercised. Only a
`pk_test_` key and a retrieved `livemode: false` allow booking, capture and tip.
SetupIntent creation does not place a fare hold. No secret Stripe key is used.

`--continue-without-hold` is an opt-in diagnostic mode honored only with verified
Stripe test mode. If booking creates a searching trip and the persisted
`metadata.e2e_test` is `true`, a failed pre-authorization records `book FAIL` with
the authorization code and readable Stripe messages from
`metadata.outstanding_balance.attempts[*].stripeError.message`, then continues
through offer, accept, en route, tracking, pickup, in progress, completion, capture,
receipt, tip, rating, and payout ledger. Capture accepts either a captured hold or a successful direct
card charge from settlement (`payment.ok`, `method: card`, `status: succeeded`,
a positive amount and PaymentIntent ID); its detail identifies which occurred.
The run still exits nonzero because booking failed. Without the flag, a failed
hold stops the ride. The flag never permits booking in live or uncertain mode,
and other failures still stop subsequent steps and run cleanup.

Failure details include underlying Supabase messages or HTTP status and JSON
error/code when available. Credentials remain redacted.

`tracking` runs between en route and pickup. It publishes two positions moving
toward Cooper Library with the native driver's `publishDriverLocation` helper
(`apps/driver/app/trip.tsx`, `packages/rides-native/driverDesk.js`): upserts to
`driver_status` and `trip_driver_locations`. Using the rider session, it mirrors
`apps/rider/lib/tripWatch.ts`'s location queries and shared `liveFixFromReads`:
read `trip_driver_locations` for this trip first, then `driver_status` for this
driver only if there is no usable trip fix. It requires the latest coordinates
within 0.00001 degrees and a timestamp from this publication, at most 30 seconds
old (one second of clock tolerance). Detail names the source and location age.

`receipt` runs after capture and before tip. It mirrors the web
`src/screens/ReceiptScreen.jsx` query in `src/lib/ratings.js`: rider-authenticated
`trips` read of receipt fields, rendered with `src/lib/receiptText.js`'s
`buildReceiptText`. The fare must equal the captured cents and the rendered total
must equal captured fare plus any existing tip. The detail reports fare, tip, and
total at that point, before the subsequent tip. No email action is invoked.

`rating` runs after tip. Both parties submit five stars with the native apps'
`submitPartyRating` (`apps/rider/components/RiderTripEnd.tsx` and the driver's
`RateTripPanel` in `packages/rides-native/PartyScreens.jsx`). That helper reads
`trips`, checks existing `ratings`, and inserts `ratings` with trip, rater, ratee,
stars, and a null comment. Each party then reads their own rating by trip and
rater to verify the saved ID, five stars, and counterpart. Writes are not retried;
only verification reads retry. These test ratings remain for audit with the trip.

Tip uses the apps' `POST /api/driver?action=tip-choice` offer and record flow:
custom $1 when the offered bounds allow it, otherwise the smallest positive
preset. The harness verifies `tip_cents > 0` through the rider's Supabase session
and reports payment diagnostics returned by record. An OK record response alone
does not pass the step.

In test mode, a missing/unreadable default card triggers confirmation with
`pm_card_visa` and saving through the normal API. A payout ledger with a positive
amount passes even if its status is pending/failed because the driver has no
Connect account. Completion can attempt a **test-mode** transfer; the harness
never invokes the daily payout cron or retries payouts.

## Cleanup and interpreting results

The driver goes offline immediately after completion and during cleanup after
failures. An unfinished trip is canceled as the rider through the settlement API;
cleanup verifies a terminal status and no open authorization in trip metadata.
The settlement cancel path releases open fare holds for marked E2E trips only.
If the booking response is lost, cleanup searches only this run's newly created
trips with the harness note. Booking and other money mutations are never retried.
Use a dedicated pair of accounts and run one harness instance at a time.

Trips remain in the database for audit with the test marker, rider note
`E2E TEST - automated harness`, and the trip ID in output. If cleanup fails (for
example, the network is down), the script exits nonzero and reports that failure;
inspect the printed trip ID or the test rider's recent trips and finish cleanup
through the app. This is application-level matching and batch-payout isolation,
not a database RLS migration. It assumes a stable deployed Stripe mode for the
duration of a run and ordinary participant access to trips. RLS-restricted payout
rows fall back to the driver's own trip `metadata.payout`.

Local verification, without production access:

```sh
node --test scripts/e2eProdRide.test.mjs
npm test
node --check scripts/e2e-prod-ride.mjs
```
