# Carpool matching and fare split

Carpool is the flagship. Airport flats stay. Friend rides stay. This layer extends `friend_rides` (`kind = carpool`) instead of a second product.

## How matching works

Open requests live in `carpool_requests` (service role only). `POST /api/carpool?action=match` inserts the signed-in rider, loads other `open` requests within ±30 minutes, and runs `matchCarpoolRequests` in `src/lib/carpoolEngine.js`.

1. **Normalize.** Each request needs pickup and dropoff coordinates. Missing coordinates are rejected. The same `userId` keeps only the latest row, so one person cannot fill a car alone.
2. **Destination cluster.** The dropoff label is matched to a Clemson neighborhood (`NEIGHBORHOODS`, including Grand Marc / Grand Mark and College Avenue, aligned with `CAMPUS_SPOTS`). Otherwise the nearest neighborhood centroid within 700m wins. A geohash precision 6 (~1.2km) is stored for riders who are between named spots.
3. **Time window.** Departures are classified in `America/New_York`:
   - `game_day` — an active `game_day_events` row, or Saturday 10:00–20:00. Queue rank 0. Window 25 min.
   - `peak_night` — Thu/Fri/Sat (and the hours just after midnight) 21:00–02:00. Rank 1. Window 20 min.
   - `class_change` — weekdays 7:40–9:20 and 15:40–17:20. Rank 2. Window 15 min.
   - `off_peak` — everything else. Rank 3. Window 20 min.
4. **Overlap score.** Two riders match only if every pair passes:
   - time delta inside the wider of their windows
   - same neighborhood, or destination within 1.2km, or same geohash and within 1.8km
   - pickups within 1.6km, or route-polyline overlap ≥ 45% (samples within 400m of the other line; a straight pickup→dropoff corridor is used when Google has not returned a polyline)
   - score ≥ 0.62, weighted 45% destination, 25% pickup, 15% time, 15% route overlap. Same neighborhood and pickups within 900m floor the score at 0.70.
5. **Seat cap.** Greedy fill in priority order, earliest departure first. A pool stops at **4 riders** even if the vehicle has more seats. A 5th mutual match stays `waiting` in the next pool. Tailgate links driven by a student can hold up to 6 in the lobby; stranger auto-match never exceeds 4.
6. **Book.** A pool of 2–4 becomes one `friend_rides` row, `kind = carpool`, `fare_breakdown.match_mode = marketplace` (no organizer-as-driver). Riders join with the existing lobby. A shared link (`POST /api/carpool?action=group` or the student-driver create flow) is the same lobby at `/carpool/:token`.

Student drivers who offer their own car still use `match_mode = student_driver`. Booking assigns them and skips the open driver search. Marketplace pools go to `trips.status = searching` so any online driver can take them.

## Fare split

Each charged seat is **50% of that rider's Standard fare** (`quoteFare` with `CARPOOL_SEAT_FRACTION_BPS` = 5000). Headcount does not change the seat price, and shares are not raised to fund the driver bonus.

A rider booking the Carpool ride type can request 1 or 2 seats. Two seats cost twice the half-fare seat. The ride-tier matcher books a shared trip at 3 riders and caps it at 4, which is the "3 or 4 riders" condition. Marketplace pools still form from 2 riders and cap at 4. A tailgate lobby driven by a student can hold 6. Those match sizes are not a second price.

The confirm card shows Standard next to the Carpool seat and **You save $X**. `POST /api/friend-rides?action=confirm-charges` refreshes that quote, then creates **one PaymentIntent per rider** for `fare_cents` (saved card off-session, or Payment Element). That amount is the seat fare, so the card hold equals the quote. The trip is booked only when every rider is paid.

Platform fee is **20%** of cash collected when that covers the driver. A first-ride comp is funded by the platform.

## Driver earns more than a solo

Named bonus id `driver_carpool_bonus`: **$2.00 per extra rider + $0.40 per mile**. Driver payout is at least solo net plus that bonus. If 80% of the pool misses that target, `subsidyCents` covers the gap. The driver home offer shows **you net**, not the rider gross, plus how much more that is than a solo trip.

`trips.metadata.driver_payout_cents` is what recent earnings use for these rides.

## The other four pieces

- **Group link.** One tap creates `/carpool/:token`. Friends join the existing lobby. Hash `#/carpool/:token` still redirects to the path form.
- **Clemson peaks.** Neighborhood list, class-change, Thu/Fri/Sat night, and `game_day_events` feed the same queues. Airport/tier surge in `src/lib/pricing.js` is unchanged.
- **First ride free.** `code_type = first_ride`. On only during `GAME_WEEKS` (Fall 2026: Sep 1–Nov 30) and only in game-day, peak-night, or class-change windows. One row in `first_ride_grants` per user and per email. Anyone with a completed trip is ineligible. That seat is charged $0 and marked paid without Stripe. Driver payout stays whole; the platform funds the gap (`subsidyCents`).
- **Ambassadors.** `code_type = ambassador` on `ambassador_codes`, link `/a/:code`. Ledger `ambassador_payout_ledger` pays $1.50 per seat on a completed attributed carpool. This is not a rider promo code.
- **Tailgate.** A party type on the same carpool quote and link. Lobby copy and, for a student driver, a cap of 6. Auto-match stays at 4.

## Privacy

Carpool lobbies show first names. After the ride is booked, public pickup/dropoff pins are rounded to 3 decimal degrees (~111m). The match queue is not readable from the browser (RLS on, no policies).

## Integration

| Surface | What this changes |
| --- | --- |
| FriendRide / carpool | Same tables, APIs, and `/carpool/:token` lobby. Marketplace rows leave `driver_profile_id` empty. |
| Rates / surge | Carpool windows live here. `getGameDayMultiplier` and airport flats are untouched. An active `game_day_events` row forces the game-day queue. |
| Incentives | Bonus id `driver_carpool_bonus`. |
| Rider promo | Not used. Ambassador and first-ride rows carry their own `code_type`. |

Apply `supabase/carpool_flagship.sql` before the live queue, first-ride ledger, and ambassador ledger will persist. Until then, the hub still shows the split, and **Share a link** still creates a `friend_rides` lobby.

## QA

`npm test` covers the engine: 4-rider pool, 5th rider waits, airport dropoff excluded, time window, duplicate user, game-day rank, each seat at 50% of Standard, driver net ≥ solo + bonus, per-rider charge plan, first-ride comp, geohash, seat caps.

Manual: hub comparison, group link into the lobby, confirm button stays disabled until the split is visible, driver offer shows net pay.
