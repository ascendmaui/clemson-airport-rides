# Fare authorization

Requesting a ride places a manual-capture Stripe PaymentIntent for the estimated fare plus a buffer. Trip end captures the final fare. Scheduling and airport booking do not charge a card and do not place that hold.

The 25% airport deposit is retired. `cardDepositCents` is 0 for every new quote. A deposit already stored on a trip is still treated as money already paid, and trip end charges only the remainder.

## Hold

- Buffer: 20% of the estimate, at least $2. A $0 estimate authorizes $0.
- Placed when a rider requests a driver, and when a scheduled ride with `deposit_cents = 0` is released into the live pool.
- Not placed at Schedule, and not placed when the rider chose ride credits.
- Capture method is `manual`. The card is asked for incremental authorization when the issuer allows it, so a higher final fare can grow the same hold.
- If Stripe is not configured (`STRIPE_SECRET_KEY` missing, or still the placeholder), the hold is skipped. No charge is invented.

## Decline

The default card is retried once after `card_declined`, `insufficient_funds`, or `charge_failed`. Other saved cards on the same Stripe customer may be charged next.

If every attempt fails at request time, the estimated fare is stored as `metadata.outstanding_balance` and the ride is still created. That failure does not set `payment_hold`, because the accept trigger blocks a trip while `payment_hold.status` is `payment_required`.

If capture fails at trip end, the same retry and backup-card path runs. A remaining failure sets `payment_hold`, stores the outstanding balance, and the settle call returns 402. The trip does not complete and the driver is not paid.

A final fare under $0.50 is waived and the hold is canceled.

## Trip end

- Final fare inside the hold: partial capture.
- Final fare above the hold: `incrementAuthorization` when the card allows it, otherwise capture the hold and charge the difference.
- Ride credits chosen for the trip: the hold is canceled and credits settle the fare.

Auth rows use `payments.kind = 'balance'`, status `pending` until capture, and idempotency key `fare_auth:<tripId>`. Pending rows are not counted as fare already paid.

## Open holds from the old deposit

1. Run the existing unpaid-airport-hold expiry (the cron or `expire-unpaid-airport-holds`) first. It cancels open Checkout sessions only while `deposit_cents > 0`. After the migration, those rows are no longer deposit trips, so the job will not cancel them.
2. Apply `supabase/migrations/20261005190000_retire_airport_deposit.sql`.

The migration sets `deposit_cents` to 0 on searching, offered, and scheduled trips that have no driver, no succeeded deposit payment, and `fare_paid_cents` below the old deposit. It records the previous amount on `metadata.deposit_retired`. It does not drop the accept trigger.

A Checkout session that is paid after that still records `fare_paid_cents` through the existing webhook. Trip end charges the unpaid remainder only.

Do not add a live Stripe secret for this change. Test and production keep the keys already configured for this app.
