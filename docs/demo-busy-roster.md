# Busy driver roster

The rider picker can show 20 display-only busy drivers below the real drivers in BUSY NOW. They cannot be selected, saved, matched, or requested and use initials avatars only.

- Web: open `/?demoBusyRoster=1` to enable for this browser or `/?demoBusyRoster=0` to disable. Hash routes also work, for example `/#pick-driver?demoBusyRoster=1`. The setting persists in localStorage as `crDemoBusyRoster`. Open `/?demoBusyRoster=clear` (or the corresponding hash parameter) to remove it and resume normal defaults. Query parameters take precedence over hash parameters.
- Web builds: `VITE_DEMO_BUSY_ROSTER=1` or `true` enables; `0` or `false` disables. Leave unset for normal defaults.
- Staging/local: the unauthenticated `GET /api/driver?action=app-config` defaults on when Host contains `clemson-staging.`, `localhost`, or `127.0.0.1`, or when `ALLOW_STAGING_DRY_RUN=1`. Other hosts default off. Responses are privately cached for 30 seconds; each client fetches once per JS session. Reload/relaunch after changing server settings.
- Server: `DEMO_BUSY_ROSTER=1` forces the server flag on; `DEMO_BUSY_ROSTER=0` forces it off, including staging. Leave unset for host-based defaults.
- TestFlight: build the rider app with `EXPO_PUBLIC_DEMO_BUSY_ROSTER=1` (or `true`) for demo builds. The App Store/live build must be built with it unset or `0` (or `false`). An explicit `0` also overrides a staging server flag.

Resolution is first defined: web browser override, build flag, server flag, development mode, then false. Native has no browser override. Failed/invalid server responses leave the server flag undefined; development builds then fall back to development mode. Live production builds default off. Busy status rotates in ten-minute time buckets when the picker renders; identities and ordering remain stable.
