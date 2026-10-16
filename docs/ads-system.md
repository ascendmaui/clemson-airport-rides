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
| Data | `supabase/migrations/20261016200000_ad_system.sql` |

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

## When John approves real tiers

1. Edit `src/content/adPackages.js`: replace `AD_PACKAGES`, remove `placeholder: true`, set `ADS_PACKAGES_APPROVED = true`.
2. In Supabase, update `public.ad_packages` to the same tiers with `active = true, placeholder = false`
   (or add rows; leave the PLACEHOLDER rows inactive).
3. Dry run, then create Stripe products/prices:
   `node scripts/ads/sync-stripe-packages.mjs` then `ADS_BILLING_ENABLED=true node scripts/ads/sync-stripe-packages.mjs --apply`
4. Set `ADS_BILLING_ENABLED=true` in the prod env. Optionally `ADS_AUTOMATION_ENABLED=true` and `ADS_PARTNER_EMAILS_ENABLED=true`.

## Autopilot cron

`POST /api/ads?action=cron` with `Authorization: Bearer $CRON_SECRET` (daily, `vercel.json`).
Plans invoice reminders every 3 days, pauses campaigns unpaid for 14 days, sends an ending notice 3 days out
and a monthly impression report on the 1st. With the flags off it returns the plan and changes nothing.
