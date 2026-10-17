# Peak pricing (surge) — design and rollout

> **2026-10-17 update (John's decision):** live pricing is now weekend 1.0x, airport rush 1.0x, and
> game day 1.25x only near Memorial Stadium on home-game days (kickoff − 4 h to + 3 h). That runs on the
> default (flag-off) path. See `docs/pricing-competitor-check.md`. The peak flag stays OFF; its
> defaults were aligned (game day +25%, airport 0%, cap +25%, scheduled rides priced at pickup time),
> and the engine caps any config at 1.25x. The pool migration below is still **not applied**.

> **Status: behind a feature flag that is OFF by default. John must still approve the pricing
> changes before the flag is turned on.** The parameter values below are the defaults from the
> pricing research (`clemson-pricing-recommendation-2026-10-15`), not live prices. Merging this
> code does not change what any rider pays or any driver earns. The migration
> `supabase/migrations/20261015170000_peak_pricing_pool.sql` is included but **not applied**.

## What it does

When the flag is on, a trip that starts in a peak window:

1. **Rider** pays a peak surcharge on top of the normal fare. It is shown before they confirm
   ("Game day peak pricing: +50% ($2.95) is included in this price.").
2. **Driver** gets a higher cut of that trip: 80% of the base fare plus 90% of the surcharge.
3. **Pool bonus**: every regular (non-peak) completed trip puts 2% of its fare into a peak pool,
   paid out of the platform's fee. A peak trip can draw a small bonus that only covers the gap
   between the higher cut and the target (+30% over what the same trip pays off-peak).
4. **Guardrails**: the platform never takes less on a peak trip than on the same trip off-peak; the
   pool never goes negative; a bonus never exceeds the pool balance.

When the flag is off, the legacy `resolveSurge` multipliers in `src/lib/fareRates.js` keep running
unchanged (see "Live pricing today" below).

## Peak detection (automatic)

| Reason | Window (America/New_York) | Default surcharge | Notes |
| --- | --- | --- | --- |
| `game_day` | 3 h before kickoff → 6 h 20 m after, Clemson **home** games only | +50% | From `shared/data/clemsonHomeFootball.js` (2026 home schedule, clemsontigers.com) or a live `game_day_events` row. TBA kickoffs use 10:00–24:00. No "every fall Saturday" fallback. |
| `airport_rush` | 05:00–08:00 and 15:00–19:00, trips to/from an airport | +10% | On-demand only. |
| `weekend_night` | Fri/Sat 22:00–02:00 | **0%** | Detected and logged, but no surcharge per research. One config change to turn on. |

Scheduled (booked-ahead) rides never get a surcharge. If several reasons apply, the highest wins.

## Parameters and why

All values live in `PEAK_DEFAULTS` (`shared/peakPricing.js`). You can override them without a deploy
by setting the `PEAK_PRICING_CONFIG` env JSON. Every value is clamped to a safe range.

| Parameter | Default | Why |
| --- | --- | --- |
| `reasonBps.game_day` | 5000 (+50%) | Research: 1.5× on real home games only (today it's 1.8× on every fall Saturday). |
| `reasonBps.airport_rush` | 1000 (+10%) | Research: 1.10× on-demand only (today it's 1.35×). |
| `reasonBps.weekend_night` | 0 | Research: no weekend surge (today it's 1.2× from Fri 5 PM through Sunday). |
| `maxSurchargeBps` | 7500 (+75%) | Research cap 1.75×. |
| `maxSurchargeCents` | $25 | Keeps long airport runs on game day from jumping more than $25. Rider-friendly. **Needs John.** |
| `surgeScheduled` | false | A booked price shouldn't move. |
| `driverPayBasis` | `pre_discount` | Research: drivers are paid on the fare before student/Tiger Pass discounts. |
| `baseShareBps` | 8000 | Same as today's 80% driver / 20% platform split and exclusive-offer ladder. |
| `surchargeDriverShareBps` | 9000 | Driver keeps 90% of the surcharge. The other 10% covers card fees on the extra charge. |
| `maxDriverCutBps` | 8800 | Driver's cut of the rider fare never goes above 88%. |
| `targetUpliftBps` / band | 3000, band 2500–5000 | John's rule: 25–50% above typical. We aim for +30%, never pay past +50%. |
| `poolContributionBps` | 200 (2%) | Taken from the platform's 20% on regular trips, so riders don't pay it. About $1.39 on a $69.73 trip. |
| `poolCeilingCents` | $1,000 | Contributions pause once the pool reaches this. |
| `maxBonusShareBps` / `maxBonusCents` | 15% of off-peak pay / $10 | Keeps the bonus modest (rule 4). |

## The math (one trip)

Let `B` be the base fare (after tier scaling, before discounts), `S` the surcharge, and `P` the pay basis (pre-discount fare).

```
S            = min(B × bps, maxSurchargeBps cap, $25)
offPeakPay   = 80% × B                         (what this trip pays a driver off-peak)
cutPay       = 80% × B + floor(90% × S)        (≤ S above off-peak, ≤ 88% of rider fare, ≤ +50%)
bonus        = min(target − cutPay, 15% × offPeakPay, $10, pool balance, room to +50%)
               where target = offPeakPay × 1.30
driverTotal  = cutPay + bonus
platformTake = riderFare − cutPay              (bonus comes from the pool, not the trip)
```

Guardrails (`checkPeakGuardrails`) fail the plan if: platform take < off-peak take, platform take
< 0, bonus > pool, pool < 0, driver > +50%, driver < off-peak pay, or surcharge < 0. `planPeakTrip`
trims the bonus, then the cut, until it passes. A peak trip falls back to regular economics before
it would ever lose money.

## Worked examples

Results from `planPeakTrip` with the defaults, pool funded. These are tested in `shared/peakPricing.test.js`.

### Grand Marc → GSP, Standard, $69.73 base

| | Off-peak | Airport rush (+10%) | Game day (+50%, $25 cap) |
| --- | --- | --- | --- |
| Rider pays | $69.73 | **$76.70** (+$6.97) | **$94.73** (+$25.00, effective +35.9%) |
| Driver cut | $55.78 (80%) | $62.05 (80.9%) | $78.28 (82.6%) |
| Pool bonus | — | $8.36 (capped at 15%) | $0 (cut already over target) |
| Driver total | $55.78 | **$70.41 (+26.2%)** | **$78.28 (+40.3%)** |
| Platform take | $13.95 | $14.65 (+$0.70) | $16.45 (+$2.50) |
| Pool | +$1.39 contribution | −$8.36 | unchanged |

### Campus trip, Standard, $5.90 base

| | Off-peak | Game day (+50%) | Airport rush (+10%) (example only) |
| --- | --- | --- | --- |
| Rider pays | $5.90 | **$8.85** (+$2.95) | $6.49 (+$0.59) |
| Driver cut | $4.72 | $7.08 (held at +50% band) | $5.25 |
| Pool bonus | — | $0 | $0.70 |
| Driver total | $4.72 | **$7.08 (+50.0%)** | $5.95 (+26.1%) |
| Platform take | $1.18 | $1.77 (+$0.59) | $1.24 (+$0.06) |
| Pool | +$0.11 contribution | unchanged | −$0.70 |

On a student-discounted game-day campus trip, the rider pays $7.96. The driver is still paid on the
pre-discount $5.90 / $8.85 basis (tested in `server/peakPricing.test.js`).

**Pool sustainability:** each $1.39 contribution from a $69.73 regular airport trip covers about
one-sixth of an $8.36 airport-rush bonus. Bonuses are always capped by the balance, so a thin pool
means smaller bonuses, never a loss.

## Ride types

Standard, Wait & Save, Extra Comfort, and Carpool all get the same surcharge percentage, applied to
their own tier fare. Carpool stays at 50% of Standard per seat. The surcharge goes in the same place
the legacy surge multiplier does today, so carpool seat pricing behaves exactly as it does under
legacy surge. Settlement guardrails run on the trip's stored fare. Payment is still a card hold, not a
deposit. The hold covers the surcharged price shown at confirm.

## Integration (reuses existing systems)

- **Fare calculation:** `server/authoritativeFare.js` `priceWithPeak` applies the surcharge where
  the legacy surge multiplier goes today (after tier scale, before discounts), so quote, checkout,
  request, and scheduled pricing all use the same path. It writes `peak_*` keys into
  `fare_breakdown`. Scheduled requests pass `scheduled=true` and get no surge.
- **Quote API:** `/api/quote-fare` returns a `peak` block. The rider tiers screen shows `riderLine`
  before confirm, and the schedule screen shows `+X%`.
- **Settlement:** `server/tripSettle.js` → `server/peakPricing.js#settlePeakPricing` writes
  `metadata.peak_pricing` and calls pool RPCs. It fails closed: if the pool is unavailable, the
  bonus is 0. Driver earnings (`shared/driverTripEarnings.js`) prefer Tiger Heat pay, then peak
  pay, then ladder net. Payouts still go through the #554 approval queue.
- **Tiger Heat (#345/#359):** on a peak trip, the Tiger Heat reservation is skipped so drivers
  aren't paid twice. Its ledger is unchanged. The peak pool has its own `peak_pool_ledger` table
  so Tiger Heat margin sums stay correct.
- **Driver "Before you go online" line and Busy areas strip:** `/api/tiger-heat` now also returns
  `peak` status (no new function). The driver app shows "+50%" instead of the legacy multiplier
  and adds a "Peak pricing now" note. The copy never promises specific earnings.
- **Boost (#369)** code was not changed. How it interacts with peak trips should be checked before launch.

## Migration (not applied)

`20261015170000_peak_pricing_pool.sql` adds:

- `peak_pool_ledger`: append-only, positive amounts, one contribution and one draw per trip
- RLS: admins can read, service role can do everything, clients get nothing
- `peak_pool_balance()`, `peak_pool_contribute()` (ceiling-aware), and `peak_pool_draw()`. Draw
  uses an advisory lock, never grants more than the balance, and is idempotent per trip.
- A trigger that strips client-supplied `metadata.peak_pricing` and `fare_breakdown.peak_*` on
  rider inserts

It's tested on PGlite in `tests/peakPoolSql.test.js`. Apply it before turning the flag on.
Settlement fails closed until then.

## Rollout

1. John approves the parameters (or edits `PEAK_PRICING_CONFIG`).
2. Apply the migration.
3. Confirm the kickoff times in `shared/data/clemsonHomeFootball.js` (VT is tentative, three are TBA).
4. Set `PEAK_PRICING_ENABLED=true` in preview, then production.

Turning the flag off goes straight back to legacy pricing.

## Live pricing (flag off), from 2026-10-17

Before 2026-10-17 production ran 1.8× game day (plus a fallback on every Aug–Nov Saturday 11:00–23:00),
1.2× weekend, 1.35× airport rush, 2.5× cap. John replaced these with:

- 1.25× game day, home games only, kickoff − 4 h to + 3 h, pickup or dropoff within 2 mi of Memorial Stadium
- 1.0× weekend, 1.0× airport rush, no fall-Saturday fallback
- 1.25× cap, never stacked

Details: `docs/pricing-competitor-check.md`.
