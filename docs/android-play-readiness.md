# Android Play readiness

**DO NOT SUBMIT.** Do not run `eas submit`, `npx eas-cli submit`, `eas submit -p android`, or any build with `--auto-submit`. Do not upload an AAB or APK in Play Console. Do not change the store listing, tracks, pricing, or countries. This file is a checklist only. Submission stays with John.

Nothing in this repo is wired to a Google Play listing. `RIDER_ANDROID_STORE_URL`, `DRIVER_ANDROID_STORE_URL`, and `ANDROID_STORE_URL` in `shared/productLinks.js` are `null`. QR codes and the Android buttons on the marketing page open `https://clemsonrides.com` until John pastes a real `https://play.google.com/...` URL for that specific app.

Bookable ride types on a listing are Standard, Wait & Save, and Extra Comfort. Do not add any other vehicle as bookable. The demo-map exception in `shared/demoFleet.js` stays out of the store listing.

## Current Android package ids

Two current binaries. The frozen TestFlight app is a third package and must not be the Play listing.

| App | Path | Android package | Version | Expo slug | EAS project | URL scheme |
| --- | --- | --- | --- | --- | --- | --- |
| Rider | `apps/rider` | `com.ascendmaui.clemsonrides.rider` | 1.1.0 | `clemson-rides-rider` | `d02319c9-69ef-4523-a0a5-6712c037d5fa` | `clemsonrides` |
| Driver | `apps/driver` | `com.ascendmaui.clemsonrides.driver` | 1.1.0 | `clemson-rides-driver` | `090d10b8-2f52-4502-ac9d-e8bd0fe35033` | `clemsonrides-driver` |
| Frozen (do not ship) | `apps/mobile` | `com.ascendmaui.clemsonairportrides` | 1.0.0 | `clemson-airport-rides` (`FROZEN_EXPO_SLUG`) | `1440e29e-13f0-4571-8f32-596ec81f3369` | `clemsonrides` (legacy) |

Package names are `expo.android.package` in each `app.json`. They match the iOS bundle ids. Expo owner is `johnmatveyev`. Production `eas.json` sets `appVersionSource` to `remote` and `autoIncrement` on the production profile, so the Play `versionCode` is not in git.

Declared Android permissions (manifest list in `app.json`; background location is not requested):

| App | Permissions |
| --- | --- |
| Rider | `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION` |
| Driver | `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `POST_NOTIFICATIONS`. The image-picker plugin also asks for camera and photo library for license, insurance, and vehicle documents. |

Both current apps declare `autoVerify` https intent filters for `clemsonrides.com` and `www.clemsonrides.com` with `pathPrefix: /`.

There is no Android block under `submit` in either current `eas.json`. Rider submit config is iOS-only (`ascAppId` `6815430021`). Driver submit config is iOS-only (`ascAppId` `6815445517`). `apps/mobile` `submit.production` is empty. Do not add a Play track to those files from this checklist.

## QR entry points

`QrMark` (`src/components/QrMark.jsx`) draws an SVG from `qrMatrix(value)` (`src/lib/qrMatrix.js`, error correction M). The marketing screen (`src/screens/Marketing.jsx`) is the only place that mounts it. Targets come from `shared/productLinks.js`.

| Where | Component | Encoded value today | When it changes |
| --- | --- | --- | --- |
| Marketing hero, “Soft launch · web” | `<QrMark value={WEB_BOOK_URL} label="Book on web" />` | `https://clemsonrides.com/#/home` | Stays the web booking URL. It is not a store code. |
| Get the app, Rider card | One `QrMark` on `app.href` while iOS and Android hrefs match | `https://clemsonrides.com/#/home` (`WEB_BOOK_URL`) | Splits into two codes when `RIDER_IOS_STORE_URL` and `RIDER_ANDROID_STORE_URL` differ. The Android code then uses `androidHref`. |
| Get the app, Driver card | One `QrMark` on `app.href` while iOS and Android hrefs match | `https://clemsonrides.com/#/driver` (`WEB_DRIVER_URL`) | Same split. The Android code uses `DRIVER_ANDROID_STORE_URL` only after it is a real Play URL. |
| Android button on each card | `<a href={app.androidHref}>` | Same web URL as the shared code | Becomes the Play URL for that app only. |

`publishedStoreUrl` accepts only `https://apps.apple.com/...` or `https://play.google.com/...`. Any other string is ignored and the button falls back to the web URL. Until a listing exists, the rider Android note is “The Play Store listing is not live yet. This opens booking on clemsonrides.com.” The driver note points at the driver web app the same way.

Do not invent a Play URL to make the QR point at the store. Set `RIDER_ANDROID_STORE_URL` or `DRIVER_ANDROID_STORE_URL` only after that app’s listing is actually published, and only for that app. One shared store URL is intentionally unused (`ANDROID_STORE_URL` stays `null`).

Related web routes the codes already open:

- Book: `https://clemsonrides.com/#/home`
- Driver desk: `https://clemsonrides.com/#/driver`
- Airport schedule: `https://clemsonrides.com/#/schedule`
- Driver signup: `https://clemsonrides.com/#/driver-signup`
- Privacy: `https://clemsonrides.com/#/privacy`
- Terms: `https://clemsonrides.com/#/terms`

## Build commands that stop before submit

Run these from the app directory. They produce a binary. They do not upload it to Play. Do not append `--auto-submit`. Do not follow them with `eas submit`.

Cloud builds need an Expo login and the EAS env vars already documented in `apps/rider/README.md` and `apps/driver/README.md` (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, optional `EXPO_PUBLIC_API_BASE`). Android maps also need `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` on that app’s EAS project (see shipped fix #306 below). Do not commit key values. A cloud build spends EAS quota. John runs it. This checklist does not run it.

Preview APK, internal distribution, no version autoincrement. This is the build to use before a store upload exists:

```bash
cd apps/rider
npx eas-cli build --platform android --profile preview --non-interactive
```

Repeat with `cd apps/driver`. `preview` sets `distribution: internal` and `android.buildType: apk`.

Development-client APK (debug client, not a store artifact):

```bash
cd apps/rider
npx eas-cli build --platform android --profile development --non-interactive
```

Local debug install on a device or emulator. This never contacts Play:

```bash
cd apps/rider
npx expo run:android
```

Production AAB, still not a submit. `production` sets `android.buildType: app-bundle` and `autoIncrement: true`, so a cloud production build bumps the remote Android version on EAS even though it does not upload to Play. Run it only when John wants that artifact. Do not add `--auto-submit`.

```bash
cd apps/rider
npx eas-cli build --platform android --profile production --non-interactive
```

Forbidden. These upload or publish:

```bash
# DO NOT SUBMIT — do not run any of these
npx eas-cli submit --platform android
npx eas-cli submit -p android --profile production --latest
npx eas-cli build --platform android --profile production --auto-submit
```

`apps/mobile` stays frozen. Do not `eas build` or submit `com.ascendmaui.clemsonairportrides` as the current rider or driver app.

## Shipped Android fixes

These are already merged. They are not a Play release.

| PR | Merged | What shipped |
| --- | --- | --- |
| [#303](https://github.com/ascendmaui/clemson-airport-rides/pull/303) | 2026-10-05 | Android Chrome location denial on confirm-pickup shows a short sentence instead of the raw `User denied Geolocation` string. A precise timeout retries once with coarse accuracy. Denial does not retry. |
| [#305](https://github.com/ascendmaui/clemson-airport-rides/pull/305) | 2026-10-05 | Website tap targets on Android (home search, sign-in links, marketing nav) meet a 44px minimum. The viewport uses `interactive-widget=resizes-content` so the keyboard does not cover the phone shell. |
| [#306](https://github.com/ascendmaui/clemson-airport-rides/pull/306) | 2026-10-05 | Rider and driver `app.config.js` write `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` into the Android manifest when the value is a real key. Empty or placeholder keys are omitted and the campus map says “Map unavailable” instead of a blank Google surface. Dark map style is shared. Driver local alerts use a `ride-requests` notification channel so `request.wav` can play on Android 8+. Background location is not requested. |

A physical Android device is still required to confirm map tiles after the key is set, and to hear the driver channel sound. That check is not a store submit.

## Play Console fields still needed from John

Create two apps. Package names must match the table above on the first upload. They cannot be changed later. Leave `com.ascendmaui.clemsonairportrides` unlisted.

### Account and signing

- [ ] Play Console developer account John will publish under (package prefix is `com.ascendmaui`).
- [ ] App 1 name confirmation: display name in repo is `Clemson RIDES`, package `com.ascendmaui.clemsonrides.rider`.
- [ ] App 2 name confirmation: display name in repo is `Clemson RIDES Driver`, package `com.ascendmaui.clemsonrides.driver`.
- [ ] Play App Signing enrollment for each app, and the upload key. The signing-cert SHA-1 is also what `docs/google-signin-setup.md` section 1.4 needs for the Android OAuth clients. It is not in git.
- [ ] `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` set on the rider EAS project and the driver EAS project for preview and production. Without it, #306 keeps the map on the unavailable state.

### Store listing (repeat for each app)

- [ ] Short description (80 characters). Not in the repo.
- [ ] Full description (4000). Not in the repo. Ride types in copy: Standard, Wait & Save, Extra Comfort only.
- [ ] App icon 512×512 PNG. Source icons live under `apps/rider/assets/images` and `apps/driver/assets/images`. The Play asset itself is not exported here.
- [ ] Feature graphic 1024×500. Not in the repo.
- [ ] Phone screenshots, at least two per app. Not in the repo.
- [ ] Tablet screenshots if Play requires them (`supportsTablet` is set on iOS; Android does not declare a separate tablet target).
- [ ] Category (John picks; Maps & Navigation or Travel & Local are the closest fits).
- [ ] Contact email. Product support constant is `rides@clemson.edu` (`SUPPORT_EMAIL`). John confirms that address is the Play listing contact.
- [ ] Website: `https://clemsonrides.com` is the public host.
- [ ] Privacy policy URL. The live page is `https://clemsonrides.com/#/privacy` (last updated September 22, 2026, `shared/legalCopy.js`). John confirms Play accepts that hash URL. If it does not, a path URL is still required. Terms are `https://clemsonrides.com/#/terms`.

### Policy forms (John answers in the console)

Use the binary and the privacy policy. Do not guess past what is listed here.

- [ ] Ads: no ad SDK is declared in these apps. John confirms the ads declaration.
- [ ] Content rating questionnaire (IARC), both apps.
- [ ] Target audience. Privacy copy says the product is for university students and adults and does not knowingly collect data from children under 13. John confirms the target-audience and “designed for children” answers.
- [ ] News app: no. Government app: no. John confirms.
- [ ] Data safety, aligned with `PRIVACY_SECTIONS`: name, email, and auth ids; student-verification marker; trip pickup and dropoff labels and coordinates; fare and deposit amounts; Stripe payment metadata (full card numbers are not stored on Clemson RIDES servers); optional phone and home/work labels; device or session signals for realtime updates. Precise location is while-in-use (`ACCESS_FINE_LOCATION`). Driver app adds the notification permission and camera or photo-library access for documents. Data is shared with Stripe, Supabase, and the driver assigned to the trip, as the policy states. John completes the form.
- [ ] Account deletion URL or in-app path. Account can file a confirmed support ticket (`shared/accountDeletion.js`, subject “Delete my Clemson RIDES account”). That path does not call `auth.admin.deleteUser`. John chooses the URL Play will show. The privacy page tells people to request deletion from Account.
- [ ] Location declaration: foreground only. No background-location permission.
- [ ] Photo and video permissions for the driver document picker, if Play asks.
- [ ] Financial-features declaration for ride deposits, if Play asks. Payments stay on the existing Stripe paths. No live charge is part of this checklist.
- [ ] Countries and regions.
- [ ] Pricing. Confirm free, with no in-app products, if that is still true at upload time.
- [ ] Internal testing track only, when John later decides to upload. Do not promote to production from this doc.

### After a listing exists (separate change, still not this task)

- [ ] Paste the published rider Play URL into `RIDER_ANDROID_STORE_URL` only. Leave the driver constant null until the driver listing exists.
- [ ] Paste the published driver Play URL into `DRIVER_ANDROID_STORE_URL` only.
- [ ] Re-check the marketing QR. `installHref` switches that app’s Android code and button from the website to the Play URL on its own. The hero “Book on web” QR stays on `WEB_BOOK_URL`.
