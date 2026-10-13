-- Supabase grants EXECUTE on new public functions to anon and authenticated.
-- These security-definer functions run from the accept trigger and from
-- accept_scheduled_trip. Clients must not call them directly.
-- REVOKE FROM PUBLIC does not remove those role grants.

REVOKE EXECUTE ON FUNCTION public.assert_driver_may_accept(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.assert_driver_may_accept(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.block_unapproved_driver_accept() FROM anon;
REVOKE EXECUTE ON FUNCTION public.block_unapproved_driver_accept() FROM authenticated;
