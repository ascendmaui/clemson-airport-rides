-- rider_driver_cards is a security-definer view. No signed-out code path reads it
-- (apps use the list_rider_driver_cards RPC), so anon loses SELECT.
-- Signed-in readers keep access.
revoke select on table public.rider_driver_cards from anon;
grant select on table public.rider_driver_cards to authenticated, service_role;

-- Known leftover: PUBLIC still held EXECUTE on the accept-gate trigger function.
do $$
begin
  if to_regprocedure('public.block_unapproved_driver_accept()') is not null then
    revoke execute on function public.block_unapproved_driver_accept() from public;
  end if;
end
$$;
