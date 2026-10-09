# Near-term schedule (rider batch 2 item 9)

When a rider schedules a ride, the server reads drivers who are approved, online, and not already on a trip. Demo map cars never count. The shortest fresh straight-line ETA is the current wait. The rider is offered pickup slots from 10 to 15 minutes out that are still at least that wait away. A wait longer than 15 minutes offers no slot.

Scheduling does not charge a card and does not start the single-driver live offer. The trip stays `scheduled` on the driver board until the pickup time. Every approved driver gets a board alert. At pickup, the existing release job moves the ride into live matching. Rides scheduled 30 minutes or more ahead are unchanged, including the 45-minute release.

## APIs

| Action | Method | Purpose |
| --- | --- | --- |
| `schedule-slots` | GET or POST `/api/stripe-payment-methods?action=schedule-slots` | Wait, available count, and slots. Body: `{ pickup: { lat, lng, label }, tier }`. No driver names. |
| `schedule-trip` | POST `action=schedule-trip` | Existing scheduler. Add `nearTerm: true` and a `pickupAt` that matches a current slot. |
| `match-notice` | GET `action=match-notice&tripId=` | Signed-in rider. Driver first name, distance, ETA, pickup time. |

Slot response fields: `waitMinutes`, `waitLabel`, `availableDrivers`, `slots[]` (`id`, `minutesOut`, `pickupAt`, `label`), `emptyMessage`, `reason`, `demoDriversExcluded`.

A rejected near-term time returns `409` `slot_unavailable` plus the current `slots`.

Tiers stay Standard, Wait & Save, and Extra Comfort.

## Events

- Schedule insert writes `trip_events.kind = scheduled` and `metadata.near_term_slot`, `schedule_window: 10_15`, `wait_minutes`, `slot_minutes_out`.
- One `driver_offer_alerts` row per approved driver, marker `scheduled-board`.
  - `in_app.sent` records the board alert.
  - `push.reason` is `push_sender_missing` when a token is stored, otherwise `push_token_missing`.
  - `sms` and `email` are `board_prefers_in_app`. Live-offer SMS and email flags are not used for this blast.
- Match pop-up reads `match-notice` when a trip becomes `accepted` with a real `driver_id`.

## Looking-for-driver Schedule button

That screen should only navigate. Do not rebuild slots there.

```js
import { nearTermScheduleRoute } from '../shared/nearTermSlots.js'

const route = nearTermScheduleRoute({
  pickupLabel: 'Memorial Stadium',
  dropoffLabel: 'Sikes Hall',
  tier: 'standard',
})
// native: router.push(route.native)  → /schedule?near=1&pickup=...&dropoff=...&tier=...
// web: navigate(route.web.path, route.web.params)
```

`/schedule?near=1` opens the 10–15 minute picker on the rider schedule screen and the website schedule planner. Labels such as Memorial Stadium and Sikes Hall are resolved from the campus catalog, including stops that are not in the short friend-ride preset list.

## Push gap

Expo tokens may already be stored on `driver_status.expo_push_token` or `driver_push_tokens`. There is no server push sender in this repo, and this change does not add Expo or Hostinger credentials. Closed-app push is recorded as not sent. While the driver app is open, the web toast and the driver local notification still say “Scheduled ride on the board.”

## QA

1. With one approved online driver near campus and the demo fleet on the map, open Schedule. Wait is short and the buttons are only 10 through 15 minutes.
2. Take that driver offline, or leave only a demo car. The picker says no drivers, or that nobody has a recent location. Confirm does not book.
3. Book a slot. The trip is `scheduled`. Each approved driver has a `scheduled-board` alert. SMS and email are not sent. The driver app shows the board toast.
4. Accept from the driver scheduled queue. The rider gets the “Driver matched” toast and a pop-up with the driver’s first name, miles away, and pickup time.
5. Advance the clock to the pickup time without an accept. The existing release turns the trip into a live search. A normal 30-minute reservation still waits until 45 minutes before pickup.
