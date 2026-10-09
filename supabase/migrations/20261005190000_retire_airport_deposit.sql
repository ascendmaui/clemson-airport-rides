-- Retire unpaid airport-deposit holds.
--
-- Apply on Supabase project awktabuhijrshmsmagpq after the unpaid-hold
-- expiry job has run. That job cancels open Checkout sessions only while
-- deposit_cents is still above zero. Running this update first would hide
-- those rows from the expiry job.
--
-- Already-paid deposits stay: a succeeded deposit payment, or
-- fare_paid_cents that already covers deposit_cents. Trip end then charges
-- only the remainder. The accept trigger is unchanged. It does nothing
-- when deposit_cents is 0.

UPDATE public.trips AS t
SET
  deposit_cents = 0,
  metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
    'deposit_retired',
    jsonb_build_object(
      'previous_cents', t.deposit_cents,
      'at', to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    )
  )
WHERE coalesce(t.deposit_cents, 0) > 0
  AND t.driver_id IS NULL
  AND t.status IN ('searching', 'offered', 'scheduled')
  AND (
    coalesce(t.metadata->>'fare_paid_cents', '') !~ '^[0-9]+$'
    OR (t.metadata->>'fare_paid_cents')::int < t.deposit_cents
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.payments AS p
    WHERE p.trip_id = t.id
      AND p.kind = 'deposit'
      AND p.status = 'succeeded'
  );
