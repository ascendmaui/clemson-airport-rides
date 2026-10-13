# Closed-app iOS push — 5 minute runbook

Do this on John's Mac after the APNs `.p8` is on disk. It uploads that key to both Expo projects and sends one test push. It does not build, prebuild, or change `app.json`.

Both apps already register Expo tokens and the server already posts to Expo:

| App | Bundle id | Expo project |
| --- | --- | --- |
| Rider | `com.ascendmaui.clemsonrides.rider` | `d02319c9-69ef-4523-a0a5-6712c037d5fa` |
| Driver | `com.ascendmaui.clemsonrides.driver` | `090d10b8-2f52-4502-ac9d-e8bd0fe35033` |

Apple team id: `L85AF3V872`.

## Before the timer

- `eas whoami` prints the Expo account that owns those two projects (`johnmatveyev`). If it does not, run `eas login` or export `EXPO_TOKEN`. Do not start a build.
- The `.p8` is the push key from Apple, named like `AuthKey_AB12CD34EF.p8`. The key id is those 10 characters.
- A phone has opened the Rider or Driver app and allowed notifications, so a row exists in `rider_push_tokens` or `driver_push_tokens`.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are in the shell for the test send. `EXPO_ACCESS_TOKEN` stays empty unless Enhanced Security for Push is on.

## Minutes 0–2 — upload the key

From the repo root, with the real path and key id:

```bash
bash scripts/push/setup-apns.sh \
  --p8 "$HOME/AuthKey_AB12CD34EF.p8" \
  --key-id AB12CD34EF
```

The script checks both `app.json` files, then runs `eas credentials --platform ios` in each app directory. It picks the **production** profile (the development profile is a simulator build and cannot take a push key), chooses **Push Notifications → Add a new push key**, answers **no** to generating a key, and uploads this `.p8` for team `L85AF3V872`. It assigns the key to that project and exits. It never runs `eas build` or `expo prebuild`.

Success is the line `Push Key assigned to` for both `clemson-rides-rider` and `clemson-rides-driver`.

If a prompt does not match, press Ctrl-C and use the same menu by hand. Still do not build.

## Minutes 2–4 — send and read receipts

```bash
node --experimental-strip-types scripts/push/test-push.ts --user <user-uuid>
```

The command reads that user's stored Expo tokens, posts one test alert per token, then polls Expo receipts for about 30 seconds. The JSON lists a redacted token, `sent`, `ticketId`, and `receipts`. `status: "ok"` means Expo handed the alert to APNs. The phone should show **Clemson RIDES test** even when the app is locked.

If `pending` still has ticket ids, receipts are not written yet. Expo can take up to 15 minutes. Fetch them without sending again:

```bash
node --experimental-strip-types scripts/push/test-push.ts --tickets <ticket-id>
```

`DeviceNotRegistered` means that token is stale. The server drops it when the receipt sweep runs. `InvalidCredentials` means the `.p8` did not land on that Expo project.

## What is already in the apps and server

- `expo-notifications` ~57 is a plugin in both `apps/rider/app.json` and `apps/driver/app.json`.
- The rider app saves `rider_push_tokens` from `apps/rider/lib/push.ts` when the app opens and again on the live-trip screen, which asks for permission.
- The driver app saves `driver_push_tokens` with feature `trip_status_v1`, and also the legacy `driver_status.expo_push_token` when that column exists (`apps/driver/lib/push.ts`).
- Offer alerts, trip-status notices, backup-driver pings, and trip messages send through `server/expoPush.js`.
- A ticket id is stored in `expo_push_tickets` when that table exists. The trip sweep `expo-push-receipts` reads Expo receipts and deletes a token whose receipt is `DeviceNotRegistered`. An immediate `DeviceNotRegistered` on the ticket is deleted without waiting for the table.

## Ops migration — do not apply from the app

`supabase/migrations/20261013270000_expo_push_tickets_OPS_APPLY_.sql` creates the private ticket table. Sends and this test script work without it. Apply it by hand when you want the server to prune dead tokens. Do not apply it from CI or a production deploy hook.

## Flagged, not changed

`app.json` was not edited. The `expo-notifications` plugin does not set `mode`. On SDK 57 the plugin default is `development`, which is the APNs sandbox entitlement for the **next** native build. A `.p8` works for both sandbox and production, and the binary already on the phone keeps the entitlement it was built with. A later production build should set the plugin `mode` to `production`. That change needs a new build, which this runbook does not do.
