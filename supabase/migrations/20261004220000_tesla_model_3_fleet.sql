-- Matching release for immediate driver requests. Later migrations keep this body.
CREATE OR REPLACE FUNCTION public.release_matching_offer(p_trip uuid, p_driver uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.trips;
  candidate uuid;
  skipped jsonb;
BEGIN
  SELECT * INTO t FROM public.trips WHERE id = p_trip FOR UPDATE;
  IF t.id IS NULL OR t.status::text NOT IN ('searching', 'offered')
     OR t.driver_id IS NOT NULL OR t.pickup_at IS NOT NULL OR t.scheduled_for IS NOT NULL
     OR coalesce(t.deposit_cents, 0) <> 0
     OR t.metadata->>'kind' IS DISTINCT FROM 'driver_request' THEN RETURN; END IF;
  -- Stale passes must never move a newer target. Pool passes only record exclusion.
  IF nullif(t.metadata->>'offer_driver_id', '') IS DISTINCT FROM p_driver::text THEN RETURN; END IF;
  skipped := coalesce(t.metadata->'offer_passed_driver_ids', '[]'::jsonb);
  IF NOT skipped ? p_driver::text THEN skipped := skipped || to_jsonb(p_driver::text); END IF;
  SELECT ds.driver_id INTO candidate
  FROM public.driver_status ds
  JOIN public.profiles p ON p.id = ds.driver_id
  WHERE ds.online IS TRUE AND ds.driver_id <> p_driver
    AND ds.driver_id IS DISTINCT FROM t.rider_id
    AND NOT skipped ? ds.driver_id::text
    AND NOT coalesce(t.metadata->'offer_tried_driver_ids', '[]'::jsonb) ? ds.driver_id::text
    AND NOT EXISTS (SELECT 1 FROM public.driver_offer_passes op WHERE op.trip_id = t.id AND op.driver_id = ds.driver_id)
    AND (EXISTS (SELECT 1 FROM public.driver_applications da WHERE da.profile_id = ds.driver_id AND da.onboarding_status = 'approved')
      OR p.is_admin IS TRUE OR p.role::text IN ('admin', 'ops')
      OR lower(p.email) IN ('johnmatveyev@gmail.com', 'ascendmaui@gmail.com', 'jmat2019@icloud.com')
      OR EXISTS (SELECT 1 FROM public.admin_users a WHERE a.email = lower(p.email) AND a.access_role IN ('admin', 'support')))
  ORDER BY coalesce((SELECT ord FROM jsonb_array_elements_text(coalesce(t.metadata->'auto_assign_queue', '[]'::jsonb)) WITH ORDINALITY q(id, ord) WHERE q.id = ds.driver_id::text LIMIT 1), 2147483647),
    CASE lower(p.email) WHEN 'johnmatveyev@gmail.com' THEN 0 WHEN 'kimubermaui@gmail.com' THEN 1 ELSE 2 END, ds.driver_id
  LIMIT 1 FOR UPDATE OF ds SKIP LOCKED;
  UPDATE public.trips SET status = 'searching', metadata = t.metadata || jsonb_build_object(
    'offer_driver_id', candidate, 'match', CASE WHEN candidate IS NULL THEN 'open' ELSE 'auto' END,
    'offer_passed_driver_ids', skipped,
    'offer_tried_driver_ids', coalesce(t.metadata->'offer_tried_driver_ids', '[]'::jsonb) || to_jsonb(p_driver::text), 'offer_release_reason', p_reason, 'offer_released_at', now())
  WHERE id = t.id AND driver_id IS NULL AND status::text IN ('searching', 'offered');
END;
$$;
REVOKE ALL ON FUNCTION public.release_matching_offer(uuid, uuid, text) FROM PUBLIC;
