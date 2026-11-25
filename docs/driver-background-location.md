# Driver app: background location (Play declaration and App Review note)

The Clemson Rides Driver app shares the driver's location in the background **only while the driver is online or on an active trip** (accepted → arriving → arrived → in trip). It stops when the driver goes offline (END) or signs out. While online with no trip, the background service starts only if "Always" was already granted; it never prompts on its own, and its writes are location-only (they never set `online`).

- Permission: `expo-location` with `isAndroidBackgroundLocationEnabled` and `isAndroidForegroundServiceEnabled` (adds `ACCESS_BACKGROUND_LOCATION` and a location foreground service). iOS `UIBackgroundModes: location`.
- Request site: `apps/driver/lib/backgroundLocation.ts` `startTripBackgroundLocation`, called only from `apps/driver/app/trip.tsx`.
- Prominent disclosure: `apps/driver/components/LocationDisclosure.tsx` (copy in `apps/driver/lib/locationDisclosure.ts`). It is a full-screen in-app screen shown **before** the OS prompt whenever background permission is not yet granted. The OS prompt only follows a tap on **Continue**. **Not now** skips the OS prompt for that trip and the trip keeps foreground-only sharing.

## Play Console: location permissions declaration (draft for John)

> Clemson Rides Driver is the driver app of a campus ride service. While the driver is online and during an active trip, the app collects the driver's precise location in the background so nearby ride requests can be matched to the driver and the rider can see the driver's car on the map, get an accurate arrival time and be told when the driver has arrived, while the driver navigates with Google Maps or Waze or the phone is locked. Background collection starts only after the driver accepts a ride and sees an in-app disclosure, and it stops when the driver goes offline. Location is not used for advertising.

Video (30 s or less): sign in as a test driver → accept a ride → the "Share your location during trips" screen → Continue → Android "Allow all the time" → open Maps; the persistent "trip in progress" notification is visible → end the trip; the notification goes away.

## App Review note (iOS, draft)

> "Always" location is used only while the driver is online or on an active trip so dispatch sees the real position and the rider can follow the driver's car while the driver uses a navigation app or the phone is locked. An in-app explanation is shown before the permission prompt, and location sharing stops when the driver goes offline. Test driver credentials are in the review notes.
