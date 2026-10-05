# Tiger Pass and favorite drivers

Frequent-rider item 10 and favorite-driver item 13. The pass name is a placeholder.

## Rename hook

Change `TIGER_PASS_NAME` in `shared/tigerPass.js`. Checkout, the rider screen, the web billing panel, quotes, and help copy read that constant (the API returns it as `name`). The product id stays `tiger_pass`. Do not add a second display-name literal.

## What a rider can do

- Subscribe from the rider app pass screen or Account → Billing on the web. Checkout is Stripe `mode: subscription` at the price in `TIGER_PASS_PRICE_CENTS` ($9.99).
- An active row takes 10% off Standard, Wait & Save, and Extra Comfort. The rate is `TIGER_PASS_DISCOUNT_BPS`. It applies after the Clemson student discount and before schedule-ahead and prepaid credits. The server reads the row. A client flag cannot turn the discount on.
- Choose preferred ride types. The only choices are Standard, Wait & Save, and Extra Comfort. Anything else, including retired fleet ids, is rejected with `ride_option_unavailable`.
- Favorite drivers from Pick a driver. Favorites persist on `profiles.favorite_driver_ids` and are offered before the open pool on auto-assign, scheduled release, and the queue a decline walks.
- While the pass is active, preferred drivers (a subset of favorites) are offered first, then other favorites, then the usual John / Kim / everyone else order. Removing a favorite removes them from the preferred list.
- Cancel keeps the discount until `current_period_end` when Stripe has a subscription id and a period end. Otherwise the pass is canceled immediately.

## Preview cars

Demo map drivers and `sim-busy-*` ids are not favorites. `favoriteIdsForMatching` drops them before save and before matching. A favorite list that contains only preview cars does not change dispatch order.

## API

`POST /api/stripe-payment-methods?action=tiger-pass`

- `op: status`
- `op: checkout`
- `op: confirm` with `sessionId`
- `op: cancel`
- `op: preferences` with `preferredDriverIds` and `preferredCarTypes`

`POST /api/stripe-payment-methods?action=favorite-drivers`

- `op: list`
- `op: set` with `driverIds`

Apply `supabase/migrations/20261005193000_tiger_pass.sql` before checkout confirmation. Without that table, preference writes return `tiger_pass_unavailable`. Favorite reads fail soft and matching continues in the default order.

The webhook activates `kind: tiger_pass` on `checkout.session.completed`. `invoice.paid` and subscription updates sync only when metadata kind is `tiger_pass`. Other subscription events stay ignored.

## Checks

1. Signed-out quote has `tigerPassApplied: false` and the same fare as before.
2. Insert an active `rider_subscriptions` row for a rider, quote a campus trip, and confirm the fare is 10% under the no-pass fare. A confirmed `@clemson.edu` Standard fare is discounted twice, multiplicatively.
3. Auto-assign with that rider’s favorite uuid first in `auto_assign_queue`, ahead of the default rank. A `demo-*` id in the same array is absent from the queue.
4. Save preferred car type values outside the three offered ids and expect 400.
5. Pick a driver, tap Save, reload, and see the driver under Preferred. Tap Save on a map preview car and see the refusal note.
6. Checkout returns a subscription session whose product name equals `TIGER_PASS_NAME`. Confirming a paid session sets `status: active`. The web return URL (`tigerPass=1` and `session_id`) confirms on Account → Billing. The rider app confirms after the checkout browser closes.
