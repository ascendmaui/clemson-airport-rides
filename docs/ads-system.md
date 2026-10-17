# Clemson Rides in-car tablet ads

Tablets sit on the back of the front seat in Clemson Rides cars and loop local business ads.
iOS (iPad Safari) and web only.

## Pieces

| Piece | Where |
| --- | --- |
| Public page and interest form | `/advertise` (alias `/partner`), `src/screens/Advertise.jsx`, leads in `ad_partner_leads` |
| Self-serve sign-up | `/advertise/signup`, `src/screens/AdsSignup.jsx` |
| Partner view (signed in, same email) | `/advertise/my` |
| Admin (owner account only) | Admin desk, tab **Tablet ads** (`/admin?tab=ads`), `src/components/AdsAdminPanel.jsx` |
| Tablet kiosk | `/tablet?device=<token>`, demo `/tablet?demo=1`, `src/screens/TabletPlayer.jsx` |
| API | `api/ads.js` (`?action=`), logic in `server/ads/*.js`, rules in `shared/ads/*.js` |
| Founding-partner application | `/advertise/apply` (`ad_partner_applications`, John approves in the admin desk) |
| QR tracking links | `/q/<token>` → `api/ads.js?action=qr` (logs the scan, 302 to the partner's deal) |
| Data | `supabase/migrations/20261016200000_ad_system.sql`, `20261017100000_ad_tracking_selfserve.sql` |

## Tables

- `ad_partners` business, contact, `stripe_customer_id`, status pending/active/suspended
- `ad_packages` price, `slot_seconds`, `frequency`, placement standard/first_in_loop/takeover, `duration_days`, `rides_included`, `game_day_boost`, `active`, `placeholder`
- `ad_campaigns` partner, package, start/end, status draft/pending_payment/active/paused/ended, `rides_purchased`, `rides_served`
- `ad_creatives` image/video upload (bucket `ad-creatives`) or `built` (name, logo, deal text, QR), `approval_status`
- `ad_devices` paired tablets (only a SHA-256 of the token is stored)
- `ad_impressions` campaign, creative, device, driver, vehicle, trip, `shown_at`, `seconds_shown`
- `ad_ride_counts` one row per campaign per trip (`ad_count_ride()`; service role only)

RLS: admins write everything; a signed-in partner reads only their own partner row, campaigns, creatives and impressions.

## Pair a tablet

1. Admin desk → **Tablet ads** → **Pair a tablet**. Enter a label and the driver's profile id
   (rides are counted from that driver's in-progress trips).
2. Copy the one-time link `https://clemsonrides.com/tablet?device=crt_…` and open it once on the tablet.
   The token is remembered on the tablet, so `/tablet` alone works after a reboot.
3. iPad: Safari → Share → Add to Home Screen, open it, then Settings → Accessibility → Guided Access
   (triple-click to lock). Galaxy tablet: Chrome in a kiosk or screen-pinning app pointed at the same link.
4. To retire a tablet, press **Revoke**. The link stops working at the next refresh (20 s).

The tablet refreshes the loop and the trip state every 20 s, caches creatives with the Cache API, keeps a
local impression queue while offline and uploads it every 30 s. A ride is counted once per campaign per trip
while the paired driver's trip is `in_progress`, using the server's view of `trips`, never the tablet's.
Campaigns drop out when `rides_served` reaches `rides_purchased` or `ends_at` passes.

## Rotation

weight = placement (standard 1, first_in_loop 2, takeover 4 on game days, 1 otherwise) × frequency × game-day boost.
`first_in_loop` ads lead each loop. Game day = Saturday 11:00–23:00 ET, Aug–Nov (same window as fares).

## Billing (OFF until the tiers are approved)

```
Partner signs up ──► ad_partners (pending) + ad_campaigns (pending_payment) + ad_creatives (pending_review)
                                   │
Admin approves creative, sets price (founding) or package price
                                   │
Admin "Send invoice"  ── ADS_BILLING_ENABLED=true? ── no ──► nothing happens
                                   │ yes
            Stripe Customer (reused) ──► Invoice (send_invoice, 14 days) ──► hosted_invoice_url
                        (or Checkout Session, mode=payment ──► session.url)
                                   │  saved to ad_campaigns.payment_url
Business pays ──► Stripe webhook /api/stripe/webhook
                  invoice.paid | checkout.session.completed  (metadata.kind = ad_campaign)
                                   │
                  ad_campaigns: status active, paid_at, starts_at, ends_at = start + duration_days
                  ad_partners: pending ──► active
                                   │
Tablets pick it up on the next 20 s refresh.
```

Flags (all default off): `ADS_BILLING_ENABLED`, `ADS_AUTOMATION_ENABLED`, `ADS_PARTNER_EMAILS_ENABLED`.
Nothing creates live Stripe objects or emails a business until those are turned on.

## Pricing model: pay per ride

Tablets are already in the cars. A business buys a bundle of rides and pays only for rides its ad is
displayed in; ads are spread across the drivers who have a paired tablet. DRAFT bundles (pending John's
approval, adjustable in `src/content/adPackages.js`): 100 rides $12, 250 $25, 1,000 $89, 5,000 $299, plus an
optional game-day weekend add-on. The `ad_packages` rows `rides-100 … rides-5000` and `game-day-weekend` are
seeded with `placeholder = true`, so billing refuses them until they are approved.

## Metrics (partner analytics at `/advertise/my`, admin desk for everyone)

Definitions live in `shared/ads/metrics.js` and show as tooltips on the page.

| Counter | Meaning |
| --- | --- |
| **QR scans** (headline) | Unique scans of the ad's tracking QR code: proof of foot traffic. Repeat scans from the same phone within 30 minutes count once. Scan rate = QR scans / rides. |
| **Rides** | Distinct rides the ad ran in. Each counts once against the bundle (`ad_ride_counts`). |
| **Impressions** | Plays shown to riders: during an in-progress ride, with the tablet screen on and the page visible for the whole slot, at least 3 seconds. |
| **Ad runs** | Every play (each loop slot), in or out of a ride. |

Every play is an `ad_impressions` row with trip id, timestamp, campaign, creative, device, partner, seconds on
screen, `visible` and the QR token on screen. The page also ranks each creative by QR scans per ride
("which ad converts best") and exports the ride list (ride ref, time ET, QR scans) as CSV.
Counters refresh every 15 seconds through `/api/ads?action=mine`, which only returns the signed-in
partner's rows (RLS also limits direct reads to the partner's own campaigns).

## QR scan tracking

The tablet never sees a partner's URL. The feed gives each creative a QR for
`https://clemsonrides.com/q/<token>`, one token per tablet + creative + ride (`ad_qr_tokens`).
A scan logs `ad_qr_scans` (time, token, campaign, creative, partner, device, ride, truncated user agent,
a salted daily visitor hash for de-duplication; no IP or other personal data) and answers
`302` to the campaign's deal link. Link previewers and bots are redirected but not counted; more than 30
scans per IP in 10 minutes are redirected but not logged. Unknown tokens go to `/advertise`.

## Self-serve (onboarded partners)

`/advertise/my` shows **Build My Ad** (builder, upload, or reuse an ad; sample templates once approved),
**Create My Campaign** (ride bundle, ad, deal link, radius 1/3/5 mi or anywhere, ride types: campus loop,
stadium runs on game days, late night 9 PM–3 AM, airport runs, all rides; optional game-day boost) and
**Launch My Campaign** (draft → pending payment; billing is off, so it stays there). Creatives still need
John's approval unless he turns on **Auto-approve creatives** for that partner (default off).
Only partners with status `active` (onboarded) see these sections. Status chips: Draft, Pending review,
Pending payment, Live, Paused, Completed.

Targeting is checked on the server against the paired driver's in-progress ride (pickup, drop-off, time,
flight). Radius needs the partner's map pin (admin desk → Set map pin); without one, radius is not enforced.

**Boost** doubles the remaining rides at the campaign's per-ride rate, after a confirmation that shows the
price. It is stored as a `pending_payment` add-on (`ad_campaign_boosts`); with billing on it gets its own
invoice (`metadata.kind = ad_boost`), and the webhook applies it when paid. The admin can apply or cancel it.

## Founding partners

"Apply to become a Founding Partner — limited spots" opens `/advertise/apply` (business, category, address,
contact, website, what they'd promote, why/offer). Applications are `pending` until John approves or
declines; approval creates or updates the partner as onboarded with `founding_approved = true`.

## Media slots (not live until approved)

`src/content/advertiseMedia.js` (How it Works video, hero rotating demo) and `src/content/sampleAds.js`
(sample gallery, builder templates, `?template=` prefill) render nothing until their flags are set.
Approved files go in `public/ads/` so they are served by the site.

## When John approves real prices

1. Edit `src/content/adPackages.js` (bundle rides and prices) and set `ADS_PACKAGES_APPROVED = true`.
2. In Supabase, update `public.ad_packages` rows `rides-*` (and `game-day-weekend`) to the same numbers
   with `active = true, placeholder = false`.
3. Dry run, then create Stripe products/prices:
   `node scripts/ads/sync-stripe-packages.mjs` then `ADS_BILLING_ENABLED=true node scripts/ads/sync-stripe-packages.mjs --apply`
4. Set `ADS_BILLING_ENABLED=true` in the prod env. Optionally `ADS_AUTOMATION_ENABLED=true` and `ADS_PARTNER_EMAILS_ENABLED=true`.

## Autopilot cron

`POST /api/ads?action=cron` with `Authorization: Bearer $CRON_SECRET` (daily, `vercel.json`).
Plans invoice reminders every 3 days, pauses campaigns unpaid for 14 days, sends an ending notice 3 days out
and a monthly impression report on the 1st. With the flags off it returns the plan and changes nothing.

## AI ad co-pilot (flag `ADS_AI_COPILOT_ENABLED`, default off)

Shown inside **Build My Ad** on `/advertise/my` only when the server flag is on. Partners describe their
deal; the co-pilot suggests offers, headlines, deal copy, layout and colors, and can iterate
("Make it bolder", "Shorter"). Code: `server/ads/copilot.js`, rules `shared/ads/copilotSafety.js`,
actions `copilot-suggest | copilot-image | copilot-video | copilot-save` on `/api/ads`.

- **Providers (server only, no new keys):** text uses the model already configured for Help and Support
  (`AI_GATEWAY_API_KEY` or `OPENAI_API_KEY` via `server/llm.js`); without one it uses built-in templates at
  no cost. 16:9 images need `ADS_AI_IMAGE_MODEL` on top of one of those keys; video has no provider yet.
  The `mine` response tells the page only `enabled`, the text source and whether images are available.
- **Caps:** `ADS_AI_PARTNER_DAILY_CAP` requests per partner per 24 h (default 20) and
  `ADS_AI_DAILY_COST_CAP_CENTS` estimated spend for everyone per 24 h (default 300), logged in `ad_ai_usage`.
- **Safety:** drink specials must say 21+ (added automatically) and can never target anyone under 21; no
  Clemson University names, logos, slogans or Tiger Paw; no car brands or driverless-car claims. Unsafe model
  lines are dropped; unsafe partner copy is refused.
- **Approval:** co-pilot output is saved as a creative with `pending_review` and goes through the normal
  admin review (or the partner's auto-approve setting at launch).
