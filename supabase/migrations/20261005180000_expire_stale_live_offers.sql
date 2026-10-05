-- Cancel unassigned offered trips that have already outlived the live-offer window.
-- Ongoing cleanup is GET /api/driver?action=rebroadcast-offers (same minute cron).
-- Targeted driver_request rows keep their offer_expires_at so rebroadcast can advance them.
-- Unpaid airport deposits stay on the 20-minute hold job. Future pickups stay scheduled.
-- A payment_required hold is left alone because trips_block_unpaid_close rejects that cancel.

create index if not exists trips_stale_offered_idx
  on public.trips (created_at, id)
  where status = 'offered'::public.trip_status
    and driver_id is null;

update public.trips
set
  status = 'canceled'::public.trip_status,
  canceled_at = coalesce(canceled_at, now()),
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'offer_expired_at', now(),
    'offer_expired_reason', 'stale_live_offer'
  )
where status = 'offered'::public.trip_status
  and driver_id is null
  and coalesce(metadata #>> '{payment_hold,status}', '') is distinct from 'payment_required'
  and (pickup_at is null or pickup_at <= now())
  and (scheduled_for is null or scheduled_for <= now())
  and (
    coalesce(deposit_cents, 0) <= 0
    or metadata ? 'checkout_deposit'
    or (
      coalesce(metadata->>'fare_paid_cents', '') ~ '^[0-9]+$'
      and (metadata->>'fare_paid_cents')::int >= coalesce(deposit_cents, 0)
    )
  )
  and not (
    offer_expires_at is not null
    and metadata->>'kind' = 'driver_request'
    and coalesce(metadata->>'offer_driver_id', '') <> ''
    and coalesce(deposit_cents, 0) = 0
    and pickup_at is null
    and scheduled_for is null
  )
  and (
    (offer_expires_at is not null and offer_expires_at <= now())
    or (
      offer_expires_at is null
      and coalesce(requested_at, created_at) <= now() - interval '15 minutes'
    )
  );
