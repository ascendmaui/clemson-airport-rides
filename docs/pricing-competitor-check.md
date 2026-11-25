# Pricing: game day, competitor check, and margin

Decided 2026-10-17 (John). Code: `shared/gameDaySurge.js`, `src/lib/fareRates.js`,
`shared/pricingCompare.js`, `shared/pricingMargin.js`, `server/pricingConfig.js`,
`server/marginAlerts.js`. Migration: `supabase/migrations/20261017120000_pricing_config_gameday.sql`.

## Surge rules (live path)

| Rule | Multiplier | When |
| --- | --- | --- |
| Weekend | 1.0x (off) | — |
| Airport rush | 1.0x (off) | Turned off so airport fares stay under UberX/Lyft (the old 1.35x was far above them). |
| Game day | 1.25x | Clemson **home** football days only, kickoff − 4 h to kickoff + 3 h (ET), and only when the pickup **or** dropoff is within 2 mi of Memorial Stadium (34.6788, −82.8432). |

* Never stacked: the highest rule wins and the cap is 1.25x (`SURGE_CAP`; DB checks also cap at 1.25).
* Scheduled rides are priced at the scheduled pickup time.
* Carpool seat = 50% of the surged Standard fare (surge applied before the 50%).
* Extra Comfort (×1.40) and Wait & Save (×0.82) keep their ratios to Standard.
* Campus airport trips (GSP/CLT) start at the campus pin, which is inside the stadium radius, so they get game-day pricing in the window. Quote, checkout, and the saved trip use the same pin.
* A live `game_day_events` row (admin special event) also opens the window; the radius still applies.
* Card holds are computed from the trip fare, so they include the surge.
* The quote API returns `gameDayPricing: { active, label: "Game-day pricing", multiplier, explainer, game }` and the rider tier sheet shows it under the upfront total.

### Home-game schedule

Table `public.clemson_home_games` (seed also in `shared/data/clemsonHomeFootball.js`).
Source: https://clemsontigers.com/sports/football/schedule/season/2026 (fetched 2026-10-17).

| Date | Opponent | Kickoff (ET) | Pricing window (ET) |
| --- | --- | --- | --- |
| Sat 2026-10-17 | Charleston Southern | 12:00 | 08:00–15:00 |
| Sat 2026-10-24 | Virginia Tech | TBA ("7:00 or 7:30 PM") | 15:00–22:30 |
| Sat 2026-11-14 | Georgia Tech | TBA | 10:00–23:59 |
| Sat 2026-11-28 | South Carolina | TBA | 10:00–23:59 |

When a kickoff is announced: `update clemson_home_games set kickoff_et = '19:30', kickoff_tba = false where game_date = '2026-10-24';`
(the server picks it up within 60 s; the change is audited).

## Config tables

| Table | What |
| --- | --- |
| `pricing_rate_cards` | Per-tier base / booking / per-mile / per-minute / minimum (cents). `standard` is seeded with today's card (119 / 265 / 114 / 18 / 590). Optional `comfort` / `wait` rows replace the ×1.40 / ×0.82 scale. No `carpool` row (always 50% of Standard). |
| `pricing_settings` | Single row: `target_margin_pct` (15), `stripe_fee_pct` (2.9), `stripe_fixed_cents` (30), `overhead_cents_per_ride` (75), `carpool_overhead_seats` (1), driver-pay floors (90 ¢/mi, 18 ¢/min, $5 min), `competitor_undercut_pct` (3), game-day knobs, `weekend_multiplier` (1), `surge_cap` (1.25). |
| `competitor_rate_cards` | competitor, tier, our_tier, base/booking/mile/minute/minimum, `min_includes_booking`, `source_url`, `source_kind`, `fetched_at`, notes. |
| `pricing_config_audit` | Trigger-written before/after JSON for every insert/update/delete on the four tables above, with `changed_by` / `change_reason`. |
| `pricing_margin_alerts` | Below-target fares (`quote`, `booking`) and blocked `--apply` runs (`compare`). |

All six are service-role only (RLS on, no policies, no anon/authenticated grants).
The server reads them with a 60 s cache (`server/pricingConfig.js`, refreshed inside `loadGameDayMultiplier`, which every pricing path awaits). A bad row or a read error keeps the last good config or the in-code seed. Client-side previews still use the in-code card; the server price is what is charged.

## Competitor sources

| Card | Numbers | Source | Kind |
| --- | --- | --- | --- |
| UberX | base $1.19, $1.14/mi, $0.18/min, Safe Ride fee $2.65, min $5.90 (all-in) | https://uphail.com/us/sc/clemson/ | third party |
| Uber Comfort | base $1.78, $1.31/mi, $0.24/min, fee $3.45, min $10.69 | https://uphail.com/us/sc/clemson/ | third party |
| Lyft (standard) | base $0.80, $1.14/mi, $0.17/min, service fee $3.25, min $3.07 + fee (+1% SC assessment, not modelled) | https://www.lyft.com/pricing/GSP | official page, search-index snapshot (direct fetch 404 on 2026-10-17) |
| Lyft Extra Comfort | base $1.37, $1.50/mi, $0.18/min, fee $3.45, min $3.98 + fee | https://www.lyft.com/pricing/GSP | same |

Uber publishes no per-city rate card for Clemson; its city page (https://www.uber.com/global/en/r/cities/clemson-sc-us/) only shows average trip prices (e.g. GSP→Clemson ~45 mi / 57 min). UpHail lists Lyft at base $1.20 with no service fee, which disagrees with Lyft's own page; the table uses Lyft's page. Real fares also move with competitor surge, which no public card shows, so treat this as the no-surge floor. Re-check at least monthly and update `competitor_rate_cards` (audited).

## Margin

    margin = (fare − driver payout − Stripe fee − overhead) / fare
    Stripe fee = round(fare × 2.9%) + $0.30   (per card charge; each carpool seat is its own charge)
    overhead   = $0.75 per ride (assumption: support, insurance reserve, maps/SMS/push, hosting;
                 replace with real monthly costs / rides)

**Driver payout formula (unchanged):** the platform fee is `round(fare × 20%)` and the driver keeps
`fare − platform fee` (80%) on the exclusive offer. The offer ladder can pay 70% (pool) or 75%
(scheduled) of the fare (`packages/rides-native/offerLadder.js`), plus boosts and tips, which are
pass-through. Quote-time checks use 80% (worst case for us); booking-time checks use the actual
`driver_earnings_cents`.

Consequence: with 80% to the driver and 2.9% to Stripe, no fare can keep more than 17.1%, and the
fixed $0.30 + $0.75 means:

* break-even fare is about **$6.15** (the $5.90 minimum loses about $0.04);
* a 15% margin needs a fare of at least **$50** (per carpool seat too).

So today only the Greenville and GSP trips clear 15%. Getting every trip to 15% while staying 3% under
Uber/Lyft is impossible without changing the driver share, the overhead assumption, or the target.
The script reports this instead of writing rates. Below-target fares are still allowed and logged.

## Scripts

    node scripts/pricing/compare-competitors.mjs            # report (DB if SUPABASE_SERVICE_ROLE_KEY is set, else in-repo seed)
    node scripts/pricing/compare-competitors.mjs --json
    node scripts/pricing/compare-competitors.mjs --offline  # in-repo seed only
    node scripts/pricing/compare-competitors.mjs --apply    # write lower rates if every rule passes

`--apply` writes only when, for every basket trip and tier (Standard, Wait & Save, Extra Comfort,
Carpool per seat, and the 1.25x game-day version), the fare is ≥ 3% under the cheaper competitor,
every rate is at or above the driver-pay floors, and the margin is at or above target. Otherwise it
writes nothing, inserts a `pricing_margin_alerts` row (`source = 'compare'`), prints the trips and
numbers, and exits 2. It only ever lowers rates.

    node scripts/pricing/margin-report.mjs [--json] [--date <ISO>]

Summarises yesterday's (ET) below-margin rides from `pricing_margin_alerts`; exit 3 when there were
any (for a scheduler). It sends nothing.

## Basket today (seed config, 2026-10-17)

```
tier      trip                ours    uber    lyft    vs cheaper  3% under?  margin  game-day  gd margin
standard  short_hop           $5.90   $5.90   $6.32   +0.0%       NO         -0.7%   $7.38     +3.0%    
standard  campus_downtown     $6.63   $6.63   $6.78   +0.0%       NO         +1.4%   $8.29     +4.5%    
standard  campus_walmart      $8.88   $8.88   $9.00   +0.0%       NO         +5.3%   $11.10    +7.7%    
standard  clemson_greenville  $45.24  $45.24  $45.05  +0.4%       NO         +14.8%  $56.55    +15.2%   
standard  clemson_gsp         $65.40  $65.40  $65.04  +0.6%       NO         +15.5%  $81.75    +15.8%   
wait      short_hop           $4.84   $5.90   $6.32   -18.0%      yes        -4.5%   $6.05     -0.3%    
wait      campus_downtown     $5.44   $6.63   $6.78   -17.9%      yes        -2.2%   $6.80     +1.6%    
wait      campus_walmart      $7.28   $8.88   $9.00   -18.0%      yes        +2.7%   $9.10     +5.6%    
wait      clemson_greenville  $37.10  $45.24  $45.05  -17.6%      yes        +14.3%  $46.38    +14.8%   
wait      clemson_gsp         $53.63  $65.40  $65.04  -17.5%      yes        +15.1%  $67.04    +15.5%   
comfort   short_hop           $8.26   $10.69  $7.43   +11.2%      NO         +4.3%   $10.33    +7.0%    
comfort   campus_downtown     $9.28   $10.69  $8.15   +13.9%      NO         +5.8%   $11.60    +8.0%    
comfort   campus_walmart      $12.43  $11.32  $10.94  +13.6%      NO         +8.7%   $15.54    +10.4%   
comfort   clemson_greenville  $63.34  $54.13  $57.02  +17.0%      NO         +15.4%  $79.18    +15.8%   
comfort   clemson_gsp         $91.56  $77.86  $82.58  +17.6%      NO         +15.9%  $114.45   +16.2%   
carpool   short_hop           $2.95   $5.90   $6.32   -50.0%      yes        -18.6%  $3.69     -11.4%   
carpool   campus_downtown     $3.32   $6.63   $6.78   -49.9%      yes        -14.8%  $4.15     -8.2%    
carpool   campus_walmart      $4.44   $8.88   $9.00   -50.0%      yes        -6.5%   $5.55     -1.8%    
carpool   clemson_greenville  $22.62  $45.24  $45.05  -49.8%      yes        +12.4%  $28.28    +13.4%   
carpool   clemson_gsp         $32.70  $65.40  $65.04  -49.7%      yes        +13.9%  $40.88    +14.5%
```

"vs cheaper" is our fare against the cheaper of UberX / Lyft for the nearest tier (Comfort vs Uber
Comfort / Lyft Extra Comfort; Standard, Wait & Save and Carpool vs UberX / Lyft standard).
