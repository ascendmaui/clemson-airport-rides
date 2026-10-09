# Web ride-offer chime

The driver web home screen plays an in-app chime for a new visible offer. This is the web path only.

## When it plays

`src/screens/DriverHome.jsx` calls `playRideRequestAlert` from `src/lib/rideAlert.js` when a searching or offered trip becomes visible to the driver who is on shift. The first poll only records offers already on screen, so opening the page does not chime for them. Later polls and the realtime subscription chime once per trip id.

`shouldAlertForRide` suppresses the chime and the haptic when `notification_prefs.ride` is false, Do Not Disturb is on, or quiet hours are active. The server `in_app` channel in `server/driverOfferAlerts.js` records the alert and does not play audio. The chime runs only while this web screen is open.

## How it plays

`playRideChime` tries a Web Audio cha-ching first (`AudioContext` / `webkitAudioContext`). If that context is missing, closed, or not running, it falls back to `public/sounds/ride-chime.wav` at `/sounds/ride-chime.wav`.

The file player ignores a failed rewind. Setting `currentTime` before the clip has metadata throws `InvalidStateError` and must not skip `play()`. If `Audio` itself is missing, the fallback returns false and does not throw.

## Native chime

The native custom ride-offer sound is draft [#254](https://github.com/ascendmaui/clemson-airport-rides/pull/254) (“Play a custom chime for new driver ride offers”, branch `cursor/driver-ride-offer-chime-0670`). That draft owns the bundled notification asset (`ride_offer_chime.wav` / `.caf`), the Expo notification sound name, and the Android `ride-offers` channel. Do not change those native sound assets, `apps/driver` notification playback, or `apps/driver/lib/feedback.tsx` from this web path.
