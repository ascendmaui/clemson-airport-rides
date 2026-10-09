-- Driver flow slice 2.5: reconcile the #411 leftover test trip.
--
-- Trip 7b2bacbd-3439-4294-9c78-ef3305888547 (e2e, Stripe test mode) was
-- canceled at $0. The server released its fare hold
-- (metadata.fare_authorization.status = 'canceled', reason settle_cancel,
-- pi_3UOfB86GhxbWOrW80CjS2jPY) but left:
--   * payments 37c4cbdb-da65-49dd-a50d-61d3dfee6ea2 (kind balance, $10.32) as 'pending'
--   * trips.payment_status as 'paid'
-- No driver_payouts row and no driver earnings exist for it.
-- The code fix in this PR stops new cases (release closes the hold row; a
-- $0 cancel records payment_status 'no_charge').
--
-- Every statement is guarded on the exact leftover state, so re-running is a
-- no-op and nothing else is touched.
--
-- Down (reversible):
--   update public.payments set status = 'pending'
--     where id = '37c4cbdb-da65-49dd-a50d-61d3dfee6ea2' and status = 'canceled';
--   update public.trips set payment_status = 'paid', metadata = metadata - 'payment_reconciliation'
--     where id = '7b2bacbd-3439-4294-9c78-ef3305888547' and payment_status = 'no_charge';

update public.payments
set status = 'canceled'
where id = '37c4cbdb-da65-49dd-a50d-61d3dfee6ea2'
  and trip_id = '7b2bacbd-3439-4294-9c78-ef3305888547'
  and stripe_payment_intent_id = 'pi_3UOfB86GhxbWOrW80CjS2jPY'
  and status = 'pending';

update public.trips
set payment_status = 'no_charge',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'payment_reconciliation', jsonb_build_object(
        'at', now(),
        'source', '20261010150000_reconcile_trip_7b2bacbd',
        'previous_payment_status', 'paid',
        'payment_id', '37c4cbdb-da65-49dd-a50d-61d3dfee6ea2',
        'previous_payment_row_status', 'pending',
        'reason', 'Canceled at $0; fare hold already released. Not paid, no payout.'
      )
    )
where id = '7b2bacbd-3439-4294-9c78-ef3305888547'
  and status = 'canceled'
  and payment_status = 'paid'
  and metadata->'fare_authorization'->>'status' = 'canceled';
