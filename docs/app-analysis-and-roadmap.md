# Clemson Rides: product analysis and roadmap to 9/10

_Review date: Oct 15, 2026. Reviewed main at `da02b38` (#528). Review only; no code was changed._

## Summary

| Product | Score today | Target | Biggest blocker | Workstream |
|---|---|---|---|---|
| Website (staging, PR #529 redesign) | **6.5 / 10** | 9.0 | Booking is broken on staging: the map fails to load, pickup defaults to the destination, and there is no fare before "Confirm and request" | Website |
| Rider app (Expo, `apps/rider`) | **7 / 10** | 9.0 | A dead Busy Areas toggle, uneven dark mode and naming, crash gaps (`renderDriver`), lists that aren't virtualized | Rider + brand + store |
| Driver app (Expo, `apps/driver`) | **6 / 10** | 9.0 | No error boundary, 64 swallowed errors, map markers that redraw constantly on Android, inconsistent shadows | Driver stability |

**Plain-English read:** All three share a real design system: Clemson orange #F56600 and purple #522D80, shared shadow styles, and a shared custom icon set. They look like one brand. What holds them back is reliability and finish, not the look. Booking on the website fails on staging. The driver app has no crash safety net. A few half-removed features remain, such as the rider's Busy Areas button. Two server-side money issues (two credit balances, 32-bit balances) and slow dispatch alerts affect all three products.

**How this was checked**
- **Website:** seen in a headless browser at 1440 and 390 wide (home, drive, why, ride-types section, booking up to "Confirm and request"). Screenshots are in `/workspace/clemson-ratings/site/` on the review box.
- **Rider and driver apps:** code reading only. Nothing ran on iOS or Android. Some rider screens were seen through the web booking flow.
- **Server items:** code reading of `server/credits.js`, `supabase/payment_failure_hardening.sql`, `server/matchingRebroadcast.js` and `server/dispatchBoost.js`.
- **Counts** (for example "64 silent catches") are pattern counts from the code and may be off by a few.

### Already done / in progress
- **PR #529 merged** to main as `ad737e6` ("Marketing site: desktop-first polish and remove TestFlight/beta prompts"). It shipped:
  - one sticky text-tab sub-nav (replacing the duplicated, cut-off pills),
  - the visible 4-column footer,
  - even card grids,
  - the WebP hero srcset,
  - "Clemson Rides" naming in marketing files and `index.html` meta.
  The website staging screenshots in this review were taken before that merge, so re-check the sub-nav and footer items on live.
- **Still open after #529:** the native apps, `shared/` copy, booking logic (pickup default, signed-out fare) and the Google Maps key.
- **Server credits, bigint and dispatch batching:** being done in the server workstream (see section 4).

---

## 1. Website: 6.5 / 10

### Why 6.5
**Working well**
- Strong first screen: the full-bleed Memorial Stadium photo, a white Lyft-style booking card, and a clear orange "Book a ride" button with two secondary actions.
- Ride-type tiles, photo "moment" tiles and the purple-to-orange "Where to next?" band share rounded corners, soft shadows and matching icon tiles.
- Images have real alt text. Nothing scrolls sideways at 390, and the marketing pages logged no console errors.
- The Drive page sells well: a pay hero, the worth-it colour gauge, and a comparison table against Uber and Lyft.

**Holding it back**
1. **Booking is broken on staging.** Google Maps returns `RefererNotAllowedMapError`: the `VITE_GOOGLE_MAPS_API_KEY` key doesn't allow the staging host. The home map shows "Oops! Something went wrong" and the pickup map is blank.
2. **Pickup defaults to Memorial Stadium** (`src/screens/ConfirmPickup.jsx`, about line 40). Choosing Memorial Stadium as the destination gives pickup = drop-off.
3. **No fare before "Confirm and request" for signed-out visitors.** `offer` is cleared when there's no user. A first-time visitor never sees a price.
4. **The home page is too long:** about 12,900px on mobile. 17 near-identical feature cards ("What it is / How it works / Why it matters"; `src/components/FeatureSections.jsx` / `FeatureBlock.jsx`) repeat the Why page.
5. **The booking app looks like a different product.**
   - On desktop it renders as a small phone-sized panel on a dark background.
   - It uses emoji (🐾 🕐 👥 🎓 🏈) instead of the site's icons.
   - The banner says "Clemson RIDES".
6. **Mobile header drops the "Book" link.** On staging the Drive sub-nav was cut off mid-word (#529 addresses this).

### Fixes to reach 9 (priority order)
| Pri | Fix | File / area | Effort |
|---|---|---|---|
| P0 | Add the staging host (and every preview/live host) to the Google Maps key's allowed websites. Show a branded "Map unavailable" card instead of Google's error | Google Cloud console; `src/components/CampusMap.jsx` | S |
| P0 | Pickup defaults to the device location or "Choose pickup", never the stadium. Block pickup = drop-off with a clear message | `src/screens/ConfirmPickup.jsx` | S |
| P0 | Show an estimated fare range to signed-out users before "Confirm and request"; ask for sign-in only at request | `ConfirmPickup.jsx`, fare quote endpoint | M |
| P1 | Cut the home features to 6 short cards with "See all" linking to Why; keep the full list on Why | `src/components/FeatureSections.jsx`, `src/screens/Marketing.jsx` | S |
| P1 | Desktop booking layout: map on the left, booking card on the right (Lyft/Uber web pattern), not a phone frame | `src/screens/RiderHome.jsx`, app-shell CSS | M |
| P1 | Replace emoji in booking screens with `SiteIcon`; rename "Clemson RIDES" in app screens | `src/screens/RiderHome.jsx` and booking components | S |
| P2 | Keep "Book" visible in the mobile header; add an edge fade on horizontal scrollers | site header CSS | S |
| P2 | Lighthouse pass (LCP under 2.5s on 4G mobile, CLS under 0.1); JS bundle is about 1.8 MB, so split the booking app from marketing | `vite.config.js` | M |

---

## 2. Rider app: 7 / 10

### Why 7
**Working well**
- **Real design system.** Colours come from `packages/rides-native/shared/theme.js`, and 58 cards use `lift()`, which sets both the iOS shadow and Android elevation. Cards look consistent.
- **Icons.** A shared custom `Glyph` set and a glass tab bar. iOS gets native glass tabs when available; Android gets a swipeable tab bar.
- **Motion.** Reanimated in the home sheet, tab pager and approach alert. Reduced motion is respected (`lib/useReduceMotion.ts`). Haptics on taps.
- **Safety and stability basics.**
  - There's an error boundary (`components/FlowErrorBoundary.tsx`, used in `_layout`, `pick-driver` and `requested`).
  - Loading skeletons.
  - 136 accessibility labels, often with hints and states.
  - Account deletion, Sign in with Apple and Google sign-in (#527).
- **Clear booking path:** home → confirm → pick driver → requested → trip end and rating.

**Holding it back**
1. **Dead Busy Areas button.** #525 removed the heat overlay, but `app/(tabs)/index.tsx` (about lines 607-650) still shows "Busy Areas · On/Off" plus time-window chips. On phones it only re-centres or zooms the map (`CampusMap.native.tsx` lines 138, 251).
2. **Shadows don't adapt to dark mode.** `lib/elevation.ts` always calls `elevationFor(level, 'light')`. The driver's `chrome.tsx` passes the scheme correctly.
3. **Naming.** `app.json` name is "Clemson RIDES" and the home banner says "Clemson RIDES". The site now says "Clemson Rides".
4. **The `renderDriver` crash gap** (`app/pick-driver.tsx` about line 249). It reads `driver?.id` but then uses `driver.id` and `driver.online` unguarded (key, onPress, styles). One null row from the API crashes the screen. A Save `Pressable` also sits inside the card `Pressable`, so taps can select the wrong thing on Android.
5. **Performance.**
   - 0 `FlatList`/`FlashList`: every list is a `ScrollView` + `.map` (schedule, friends, history, pick-driver).
   - 27 `setInterval`s.
   - Two map markers use `tracksViewChanges` = true (`CampusMap.native.tsx` lines 349 and 372), so they redraw every frame on Android.
   - Very large screens: home 972 lines, schedule 1,358 lines.
6. **Error handling.**
   - About 19 `.then()` chains with no `.catch` (heaviest: `lib/friendsApi.ts`, `app/requested.tsx`, `app/pick-driver.tsx`, `app/notifications.tsx`).
   - 27 empty catches swallow failures.
   - NetInfo is used in only 3 places, so most screens have no offline state.
7. **Dark mode and accessibility.**
   - 73 hard-coded hex colours in screens bypass the palette.
   - No `maxFontSizeMultiplier` anywhere, so large Dynamic Type can break fixed layouts.
   - About 51 text styles use font sizes of 11pt or less.
8. **Images.** No ride-type or car artwork; the only images are profile photos. The app icons are about 275 KB PNGs.

### Fixes to reach 9 (priority order)
| Pri | Fix | File / area | Effort |
|---|---|---|---|
| P0 | Guard `renderDriver`: filter null rows before render, use `driver?.id`, and move Save out of the card's press area | `app/pick-driver.tsx` | S |
| P0 | Remove the Busy Areas toggle and heat-window chips, or wire them to a real overlay. Keep Game day and Surge | `app/(tabs)/index.tsx`, `components/CampusMap.native.tsx` | S |
| P0 | Add `.catch` with a user-visible toast to the 19 unhandled chains; replace empty catches on booking, payment and trip paths with logging and a toast | `lib/friendsApi.ts`, `app/requested.tsx`, `app/pick-driver.tsx`, `lib/accountApi.ts`, … | M |
| P0 | Rename to "Clemson Rides" (`app.json` `name`, home banner, permission strings). Requires a store metadata update | `app.json`, `app/(tabs)/index.tsx`, `NS*UsageDescription` | S |
| P1 | Dark-aware shadows: pass the scheme into `elevationFor` | `lib/elevation.ts` | S |
| P1 | Lists to `FlatList`/`FlashList` for schedule, history, friends and pick-driver | the matching `app/` screens | M |
| P1 | Set `tracksViewChanges` false after first render on custom markers; memoise the marker arrays | `components/CampusMap.native.tsx` | S |
| P1 | Offline banner from NetInfo in the root layout, plus retry on the booking, requested and trip screens | `app/_layout.tsx` | M |
| P1 | Replace the 73 hex literals with palette tokens; check AA contrast of orange text on white (#F56600 on white is about 3:1, so for small text use purple or a darker orange) | screens, `lib/palette.ts` | M |
| P2 | `maxFontSizeMultiplier` (about 1.4) on dense chips and tabs; test at the largest Dynamic Type; bring text under 12pt up to at least 12 | shared Text wrapper | M |
| P2 | Ride-type illustrations (Standard, Comfort, Carpool, Wait & Save) on the booking sheet; compress the icons | `assets/images`, `packages/rides-native/rideTypeIcons.js` | M |
| P2 | Split `index.tsx` and `schedule.tsx` into memoised sections to cut re-renders from 1s timers | `app/(tabs)/` | L |

---

## 3. Driver app: 6 / 10

### Why 6
**Working well**
- The offer flow is the most polished part of either app:
  - a Reanimated offer countdown gauge (`components/OfferGauge.tsx`),
  - swipe-to-start (`SwipeToStart.tsx`) with accessibility labels,
  - haptics in 6 files,
  - a demand heat legend on the map (#525).
- Same shared theme and icons as the rider app. The orange-glow "Go online" button (`components/shell.tsx`) has a strong look.
- Broad coverage: online, offer, trip, earnings, payouts, tax, W-9, documents, onboarding, quiet hours. There's an offline action queue (`lib/actionQueue.ts`).
- 202 accessibility labels, and reduced motion is respected (`lib/enterMotion.tsx`).

**Holding it back**
1. **No error boundary anywhere.** One render error during a trip blanks the whole app with no way back. The rider app has `FlowErrorBoundary`; the driver app doesn't.
2. **Silent failures.**
   - 64 empty catches (`.catch(() => {})`, `.catch(() => null)`) plus about 8 `.then()` chains with no catch (`app/(tabs)/index.tsx`, `app/queue.tsx`, `components/CampusEventsCard.tsx`, `FlightsLandingCard.tsx`, `lib/actionQueue.ts`, …).
   - Note: the earlier "about 44 unhandled `.then()`" figure is mostly chains that do have a `.catch`. The bigger problem is the catches that hide the error.
   - Accept, start and end trip failures can look like "nothing happened".
3. **Map performance on Android.** Custom `<Marker>` children (request dots and the car marker in `components/CampusMap.native.tsx` about lines 214-236) have no `tracksViewChanges={false}`, so Android redraws them constantly, which costs battery during a whole shift. The car marker also uses Ionicons directly, not the shared `Glyph`.
4. **Re-renders.**
   - The offer card ticks `setTick` every 1s inside the 1,171-line home screen file.
   - `app/trip.tsx` runs two 1s timers and two 5s polls (lines 80, 92, 243 and 287) on top of realtime updates.
   - 0 virtualized lists (queue, earnings activity, documents).
5. **Inconsistent shadows.** Only 2 places use the shared `shadowStyle`; the rest are hand-written (`shell.tsx`, `PerksStrip`, `ForecastCard`, `EarningsBoard`, `OfferGauge`). The orange glow becomes a grey elevation shadow on Android.
6. **Dark mode.** 102 hard-coded hex colours in screens.
7. **Store review risk: background location.**
   - `UIBackgroundModes: location` and `isAndroidBackgroundLocationEnabled` are on.
   - Google Play requires a prominent in-app disclosure before `requestBackgroundPermissionsAsync` (`lib/backgroundLocation.ts` line 156), plus a Play Console declaration and video.
   - Apple asks why "Always" is needed.
   - I didn't confirm a disclosure screen in the code. Please verify.
8. **Naming.** "Clemson RIDES Driver", and permission strings say "Clemson RIDES".

### Fixes to reach 9 (priority order)
| Pri | Fix | File / area | Effort |
|---|---|---|---|
| P0 | Add a root error boundary with a branded "Something went wrong · Reload" screen that keeps an active trip recoverable (reload into `trip.tsx` from saved trip state); report errors | `app/_layout.tsx`, new `components/ErrorBoundary.tsx` (port the rider's `FlowErrorBoundary`) | S |
| P0 | Replace the 64 silent catches on the accept, start, arrive, end, cash-out and documents paths with log + toast + retry; add `.catch` to the remaining `.then()`s | `app/(tabs)/index.tsx`, `app/trip.tsx`, `app/queue.tsx`, `lib/actionQueue.ts`, cards | M |
| P0 | Background location: prominent disclosure screen before the permission prompt; Play declaration; Apple review note | `lib/backgroundLocation.ts`, onboarding | S |
| P0 | `tracksViewChanges={false}` (set true for one frame on change) on custom markers; memoise `markers` | `components/CampusMap.native.tsx` | S |
| P1 | Move all shadows to `shadowStyle(colors.shadow, level, scheme)`; keep the one orange glow, with an Android fallback (orange border or ring) | `components/shell.tsx`, `PerksStrip`, `ForecastCard`, `EarningsBoard`, `OfferGauge` | S |
| P1 | One shared 1s clock (context or Reanimated) instead of per-card `setTick`; merge the trip polls behind realtime with a single fallback poll | `app/(tabs)/index.tsx`, `app/trip.tsx` | M |
| P1 | Offline banner plus queue status ("2 actions waiting to sync") using `actionQueue` | `app/_layout.tsx`, `lib/actionQueue.ts` | M |
| P1 | Replace the 102 hex literals with palette tokens; QA dark mode at night (drivers mostly drive at night) | screens, `lib/palette.ts` | M |
| P2 | Rename to "Clemson Rides Driver" in `app.json` and permission strings | `app.json` | S |
| P2 | Virtualize queue, earnings activity and documents lists; split the home screen into memoised parts | `app/` | M |
| P2 | Heat map: draw with a single polygon/overlay layer rather than many `Circle`s; add a short legend tooltip | `components/CampusMap.native.tsx`, `lib/useDemandHeat.ts` | M |

---

## 4. Shared server issues (affect rider, driver and website)

| Pri | Issue | Where | Fix | Effort |
|---|---|---|---|---|
| P0 | **Two credit balances disagree.** `credit_accounts.balance_cents` is what wallet operations read and write; `profiles.credit_balance_cents` is a mirror. If someone edits the profile value (for example sets $1,000,000), the next wallet operation reads `credit_accounts` ($52), adds the change and overwrites the profile. The $1M "resets" to about $52. The JS fallback in `server/credits.js` also does an unlocked read-then-write (race) | `server/credits.js` (`applyCredits` fallback), `supabase/payment_failure_hardening.sql` (`apply_credit_delta`) | Make `credit_accounts` plus the ledger the only source of truth. Make the profile column a read-only view or trigger, or drop it. Remove the JS fallback write path; fail closed if the RPC is missing. Admin grants go through `apply_credit_delta` only | M |
| P0 | **32-bit balances.** `balance_cents`, `credit_balance_cents`, `delta_cents` and `balance_after` are `integer` (max 2,147,483,647 cents, about $21.47M); the function variables are also `integer`. Large admin grants or sums error out or overflow | same SQL | Migrate to `bigint` (columns and function args/vars) and add a sane max-grant check | S |
| P1 | **Dispatch N+1.** `server/matchingRebroadcast.js` (about line 110) awaits `alertDriver` once per driver per trip, one after another. Each call does its own profile and push-token lookups (`driverOfferAlerts.js` about lines 82-83). `dispatchBoost.js` (line 47) awaits a safety score per driver in a loop | `server/matchingRebroadcast.js`, `server/driverOfferAlerts.js`, `server/dispatchBoost.js` | Batch-load profiles and push tokens for all drivers in one `in()` query, then send in parallel with a concurrency cap (`Promise.allSettled`). Batch the safety scores | M |

---

## 5. Path to 9

### What "9" means (observable criteria)
- **Website 9:**
  - A signed-out visitor at 390 and 1440 can pick pickup and destination on a working map and see a fare estimate before signing in, with no console errors.
  - The home page is at most about 5 screens tall on mobile.
  - Lighthouse mobile Performance ≥ 85 and Accessibility ≥ 95.
  - No emoji icons; "Clemson Rides" everywhere.
- **Rider 9:**
  - No dead controls.
  - A full booking (home → confirm → pick driver → requested → trip end → rate) works with no crash on iOS and Android, in light and dark mode and at the largest Dynamic Type.
  - Every failed network action shows a message and a retry.
  - Lists scroll at 60fps with 200 items.
  - Crash-free sessions ≥ 99.5% in TestFlight or internal testing.
- **Driver 9:**
  - A thrown render error shows a recovery screen, and an active trip resumes after reload.
  - Accept, start and end failures always show a toast and retry.
  - A 4-hour online shift on a mid-range Android doesn't overheat or drain abnormally (markers not redrawing).
  - Consistent shadows in light and dark mode.
  - The background-location disclosure passes Play review.
  - Crash-free sessions ≥ 99.5%.

### Website (6.5 → 9.0), workstream: Website
| # | Fix | Why it moves the score | + Score | Running | Acceptance check |
|---|---|---|---|---|---|
| 1 | Allow all site hosts on the Maps key, plus a branded map fallback | Booking is unusable without a map | +0.8 | 7.3 | No `RefererNotAllowedMapError` on staging or live; map tiles render at 390 and 1440 |
| 2 | Pickup = device location or "Choose pickup"; block pickup = drop-off | Removes a visible bug on the first booking step | +0.4 | 7.7 | Choosing Memorial Stadium as destination never pre-fills it as pickup |
| 3 | Signed-out fare estimate before "Confirm and request" | Price is the #1 question; Lyft and Uber show it up front | +0.5 | 8.2 | Signed-out confirm screen shows a $ range for each ride type |
| 4 | Home features cut to 6 cards + "See all" | Removes the text wall; faster scan | +0.3 | 8.5 | Mobile home height ≤ about 4,500px |
| 5 | Desktop booking layout (map plus side card) | Desktop no longer looks like a phone mock-up | +0.3 | 8.8 | At 1440 the booking view uses the full width |
| 6 | Emoji → `SiteIcon`; "Clemson Rides" in booking screens (#529 covers marketing only) | One brand from marketing into booking | +0.2 | 9.0 | `rg` finds no emoji or "Clemson RIDES" in `src/screens` booking files |
| 7 | Lighthouse and bundle split; "Book" in the mobile header | Speed and access to the core action | +0.2 | 9.2 | Lighthouse mobile Perf ≥ 85, A11y ≥ 95 |

_#529 (in progress) already covers: the sub-nav, footer, grids, hero WebP and marketing naming. That's part of today's 6.5 baseline on staging, not extra credit._

### Rider (7.0 → 9.0), workstream: Rider + brand + store
| # | Fix | Why it moves the score | + Score | Running | Acceptance check |
|---|---|---|---|---|---|
| 1 | Guard `renderDriver` (null rows, nested Pressable) | Removes a crash on the core booking screen | +0.4 | 7.4 | Unit test: `pick-driver` renders with `[null, {}, validDriver]` without throwing |
| 2 | `.catch` + toast on the 19 chains; no silent catches on booking, pay and trip | Failures become visible and recoverable | +0.4 | 7.8 | `rg` count of `.then(` with no `.catch` in booking files = 0; airplane-mode test shows toasts |
| 3 | Remove or wire the Busy Areas toggle | No dead controls | +0.2 | 8.0 | Toggle gone, or toggling visibly changes the map |
| 4 | Offline banner + retry on the booking, requested and trip screens | Expected polish for a ride app | +0.3 | 8.3 | Turn off network: banner appears in under 2s; actions retry on reconnect |
| 5 | Dark-aware shadows + hex → palette tokens + AA contrast | Dark mode looks intentional | +0.3 | 8.6 | Screenshots of all tabs in dark mode with no white-glow or light shadows; text contrast AA |
| 6 | Virtualized lists + marker `tracksViewChanges` fix | Smooth scrolling and maps on Android | +0.2 | 8.8 | 200-item schedule/history scrolls without dropped frames on a mid Android |
| 7 | "Clemson Rides" name and permission strings | Brand consistency in the store and on the home screen | +0.1 | 8.9 | `app.json` name = "Clemson Rides" |
| 8 | Dynamic Type caps and ride-type illustrations | Accessibility and visual richness | +0.2 | 9.1 | Largest text size: no clipped buttons; booking sheet shows ride-type art |

### Driver (6.0 → 9.0), workstream: Driver stability
| # | Fix | Why it moves the score | + Score | Running | Acceptance check |
|---|---|---|---|---|---|
| 1 | Root error boundary + active-trip recovery | Biggest single risk: a crash mid-trip | +0.8 | 6.8 | Forced throw in a trip screen shows a recovery screen; Reload returns to the same trip |
| 2 | Surface errors on accept, start, arrive, end, cash-out and documents (no silent catches) | Drivers never get "nothing happened" | +0.6 | 7.4 | Airplane-mode tap on Accept, Start and End shows a toast and retry; silent-catch count on these paths = 0 |
| 3 | Marker `tracksViewChanges` fix + memoised markers | Battery and heat over a shift on Android | +0.4 | 7.8 | Android profiler: map idle CPU near zero while online |
| 4 | Shared clock + one trip poll | Fewer re-renders, smoother offer and trip screens | +0.3 | 8.1 | React DevTools: home screen doesn't re-render every second |
| 5 | Shadows through `shadowStyle` + Android glow fallback | Visual consistency (the known issue) | +0.3 | 8.4 | `rg shadowColor` in driver components only in `shadowStyle` or the glow token |
| 6 | Offline banner + action-queue status | Trust on spotty cell service | +0.3 | 8.7 | With no network, "N actions waiting to sync" shows and clears on reconnect |
| 7 | Background-location disclosure + store notes | Prevents a Play rejection that would block release | +0.2 | 8.9 | Disclosure shown before the OS prompt; Play pre-launch report clean |
| 8 | Dark-mode tokens (102 hex) + "Clemson Rides Driver" | Night use is the main use | +0.2 | 9.1 | Dark-mode screenshots of online, offer, trip and earnings all on palette |

### Cross-product: on-brand and connected pass (all workstreams)
**Criteria**
- **One name:** "Clemson Rides" (and "Clemson Rides Driver") in the site, app names, banners, permission strings, emails and store listings.
- **One look:** colours, shadows, radius and type from `packages/rides-native/shared/theme.js`. No raw hex in screens. Icons from the shared `Glyph` (apps) and `SiteIcon` (web), no emoji.
- **Connected:**
  - "Book a ride" on the site opens the app when it's installed (universal links for `clemsonrides.com` are already set up), otherwise the web booking.
  - "Drive" links to driver onboarding.
  - Ride types, prices and the student discount read identically in all three (one copy source in `shared/`).
- **Money is consistent:** the credit balance shown in the rider app, website and admin comes from one source (`credit_accounts`). See server P0.
- **Check:** a side-by-side screenshot set (site home, web booking, rider home, driver home; light and dark) reviewed by John before release.

---

## 6. Combined roadmap

**Week 1: P0s (stop the bleeding)**
- **Website:** Maps key and fallback; pickup default; signed-out fare.
- **Rider:** `renderDriver` guard; error toasts; remove the Busy Areas toggle; rename.
- **Driver:** error boundary; surface errors; marker fix; background-location disclosure.
- **Server:** single credit source of truth; bigint migration.

**Week 2: P1s (polish and performance)**
- Home page trim and desktop booking layout.
- Dark-mode tokens in both apps; shared shadows in the driver app.
- Offline banners; virtualized lists; driver clock and poll consolidation.
- Dispatch N+1 batching.

**Week 3: P2s and the brand pass**
- Ride-type art; Dynamic Type QA; Lighthouse and bundle split.
- Heat-map layer; screen splits.
- The cross-product on-brand and connected review, then store metadata updates.

**Expected end state:** Website about 9.2, Rider about 9.1, Driver about 9.1, if the acceptance checks above pass on real iOS and Android devices.
