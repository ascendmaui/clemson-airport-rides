# Live driver location

Active-trip telemetry is stored in `public.trip_driver_locations`, one row per
trip. The row contains `trip_id`, `driver_id`, `lat`, `lng`, `heading`, `speed`,
and `updated_at`. `driver_status` remains availability and the 500m arriving
trigger. Riders read the trip row first and use that presence row only when the
trip row is missing or has no coordinates, so a web driver and a native driver
are visible to either rider app. Demo cars are still not a tracking source.

## Driver write

While a driver is on shift and their assigned trip is `accepted`, `arriving`,
`arrived`, or `in_progress`, upsert their row by `trip_id`. Web and native
both do this. Publish from a GPS watcher at least every four or five seconds,
or immediately after 15m of movement. Web also writes `driver_status` lat/lng
while online, including before the trip row exists, so the arriving trigger
can see the driver. That presence write does not change the online flag.
Use the current signed-in user's ID as `driver_id`; do not accept it from an
untrusted caller. Stop the watcher as soon as the trip is terminal or the
driver goes off shift.

RLS permits this only when `auth.uid()` is the assigned driver, the trip is
active, and `driver_status.online` is true. GPS permission-denied and timeout
states should be surfaced without ending the trip UI.

## Rider read and realtime

For an active trip, read:

```sql
select trip_id, driver_id, lat, lng, heading, speed, updated_at
from trip_driver_locations where trip_id = :trip_id
```

Subscribe to `postgres_changes` on `public.trip_driver_locations` filtered by
`trip_id=eq.:trip_id`; refresh the row when an event arrives. Use polling no
slower than every 10 seconds (the web app uses 8 seconds) if realtime is not
available. If that row is empty, read `driver_status` lat/lng for the assigned
driver and subscribe to that row as well. RLS allows the trip row only to that
trip's rider while the trip remains active. The presence fallback needs
`driver_status_assigned_rider_read` from
`supabase/migrations/20261007130000_driver_status_rider_location_read.sql`
(not applied by this branch). Hide the pin and ETA immediately on completion
or cancellation.

Interpolate the marker between fixes and rotate it by `heading` when available.
Compute the ETA from this row to pickup before `in_progress`, then to drop-off;
rate-limit ETA refreshes. Never use simulated/demo fleet positions for ETA.
