# Matching edge cases

Shared helpers in `server/matchingEdge.js` decide three real-time matching edges. They do not expire stale offers, and they do not replace the database triggers in `supabase/migrations/20261004160000_matching_decline_offline.sql` or the minute rebroadcast sweep.

Run `node --test server/matchingEdge.test.js`.

## Rider cancel while searching

`searchingCancelBlocksLaterAccept` is true when a trip is canceled or cancelled and still has no assigned driver. A later accept of that same offer is blocked. A live `searching` or `offered` row is still open. A cancel after a driver was assigned is not this path. Missing trip data blocks the accept.

## Driver decline

`declineRebroadcastFlags` applies only to an immediate, zero-deposit `driver_request` whose current `offer_driver_id` is the declining driver, while the trip is `searching` or `offered` and unassigned. It keeps the rider `searching` with no assigned driver. It records that driver on `offer_tried_driver_ids` and `offer_passed_driver_ids`, points `offer_driver_id` at the caller-supplied next driver or clears it, and sets `match` to `auto` or `open`. `offer_release_reason` and `offer_rebroadcast_reason` are `driver_decline`.

The caller passes the next eligible driver. This helper does not query presence. A stale decline does not move another driver's target. The rider, the declining driver, and anyone already tried or passed are not chosen as next. Scheduled rides, airport deposit holds, and other trip kinds are unchanged. Unrelated metadata is preserved. The row stays `searching`, so the stale live-offer canceler does not take a targeted decline.

## Offline offer card

`activeOfferCard` returns the card only while `online` is exactly true and the card status is `searching` or `offered`. Going offline clears it. The card object itself is not mutated. `offlineWhileOfferedMessage` is the copy for that moment: "You are offline. This offer is no longer on your card." An accepted trip does not use that message.
