-- Harden function grants flagged by the Supabase security advisor (2026-10-07).
--
-- Why anon/authenticated still had EXECUTE after earlier "revoke ... from public":
-- Supabase's default privileges grant EXECUTE on new public functions directly to
-- anon, authenticated and service_role, so revoking from PUBLIC alone leaves those
-- explicit grants in place. Revoke from the roles by name.
--
-- Rules used here:
--   * RLS policy expressions run as the caller, so any function a policy calls must
--     stay executable by the policy's role (authenticated).
--   * Trigger functions are not ACL-checked when a trigger fires; EXECUTE only matters
--     for direct calls (e.g. POST /rest/v1/rpc/...), which a trigger function never needs.
--   * A function called only from inside a SECURITY DEFINER function owned by postgres
--     is executed with the owner's privileges, so the API roles need no grant.
--   * service_role keeps EXECUTE everywhere (server/admin tooling).
--
-- CREATE OR REPLACE keeps these ACLs. A future DROP + CREATE of any function below
-- would re-apply the default grants, so repeat the revoke in that migration.

-- 1. Pin search_path on the two functions without one (both reference only
--    schema-qualified objects, so this does not change behavior).
alter function public.enforce_background_attestation() set search_path = public, pg_temp;
alter function public.lost_item_thread_window() set search_path = public, pg_temp;

-- 2. driver_approval_ready(uuid): SECURITY DEFINER, takes any profile id. Only caller is
--    public.review_driver_application (SECURITY DEFINER, owner postgres). No client .rpc(),
--    no policy, no view references it. Remove API access.
revoke all on function public.driver_approval_ready(uuid) from public, anon, authenticated;
grant execute on function public.driver_approval_ready(uuid) to service_role;

-- 3. release_matching_offer(uuid, uuid, text): SECURITY DEFINER, rewrites a trip's offer.
--    Only callers are the matching_offer_passed / matching_driver_offline triggers (both
--    SECURITY DEFINER, owner postgres). No client .rpc(). Remove API access.
revoke all on function public.release_matching_offer(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.release_matching_offer(uuid, uuid, text) to service_role;

-- 4. Trigger-only SECURITY DEFINER functions from the trip messaging / lost-item work.
revoke all on function public.trip_messages_before_write() from public, anon, authenticated;
revoke all on function public.trip_lost_item_reports_before_write() from public, anon, authenticated;
grant execute on function public.trip_messages_before_write() to service_role;
grant execute on function public.trip_lost_item_reports_before_write() to service_role;

-- Intentionally unchanged:
--   can_access_trip_messages(uuid), can_send_trip_message(uuid), can_open_lost_item_report(uuid)
--   are called by RLS policies on trip_messages / trip_lost_item_reports (to authenticated),
--   so authenticated must keep EXECUTE. anon/PUBLIC already have no grant on them.
--   lost_item_thread_window() keeps its authenticated grant (returns a constant interval,
--   not SECURITY DEFINER).
