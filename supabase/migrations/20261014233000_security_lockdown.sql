-- Clemson Rides security lockdown (2026-10-14). Approved by John: additive /
-- permission-tightening only. Idempotent; safe to re-run.
--
-- 1. Sole admin: johnmatveyev@gmail.com. Others demoted to their normal role.
-- 2. SECURITY DEFINER functions: no PUBLIC/anon EXECUTE unless intentionally
--    public; authenticated only for app RPCs and RLS helpers; else service_role.
-- 3. search_path pinned to public, pg_temp on every flagged function.
-- 4. RLS: anon exposure removed (profiles, location shares, live driver GPS),
--    client payment-row forgery removed, server-only tables locked.

begin;

-- ---------------------------------------------------------------------------
-- 1. Sole admin
-- ---------------------------------------------------------------------------
-- protect_profile_privileges re-promoted any profile whose JWT email was in
-- admin_users, and reverted direct is_admin=false edits made without a JWT.
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  jwt_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  row_email text := lower(coalesce(new.email, ''));
  seeded boolean;
  -- Direct DB sessions (migrations, SQL editor) carry no API role.
  direct_db boolean := coalesce(auth.role(), '') = '' and session_user not in ('anon', 'authenticated', 'authenticator');
  privileged boolean := public.is_service_role() or direct_db or public.is_admin();
begin
  seeded := exists (
    select 1 from public.admin_users a
    where a.access_role = 'admin' and a.email in (jwt_email, row_email) and a.email <> ''
  );

  if jwt_email in ('john@gmail.com', 'johnmatveev@gmail.com') then
    new.is_admin := false;
    if new.role::text in ('admin', 'ops') then new.role := 'rider'; end if;
    return new;
  end if;

  if not privileged then
    if tg_op = 'INSERT' then
      new.is_admin := false;
      if new.role::text in ('admin', 'ops') then new.role := 'rider'; end if;
    else
      new.is_admin := old.is_admin;
      if new.role::text in ('admin', 'ops') and new.role is distinct from old.role then
        new.role := old.role;
      end if;
    end if;
  end if;

  -- Whatever the writer, only an admin_users 'admin' row may hold admin.
  if (new.is_admin or new.role::text in ('admin', 'ops')) and not seeded then
    new.is_admin := false;
    if new.role::text in ('admin', 'ops') then
      new.role := case when tg_op = 'UPDATE' and old.role::text not in ('admin', 'ops') then old.role else 'rider' end;
    end if;
  end if;
  return new;
end;
$function$;

delete from public.admin_users
where access_role = 'admin' and lower(email) <> 'johnmatveyev@gmail.com';

alter table public.admin_users drop constraint if exists admin_users_sole_admin;
alter table public.admin_users add constraint admin_users_sole_admin
  check (access_role <> 'admin' or lower(email) = 'johnmatveyev@gmail.com');

-- Demote to the normal role each account already uses.
update public.profiles p
set is_admin = false,
    role = case
      when exists (select 1 from public.driver_status ds where ds.driver_id = p.id)
        or exists (select 1 from public.driver_applications da where da.profile_id = p.id)
      then 'driver'::public.user_role
      else 'rider'::public.user_role
    end
where (p.is_admin or p.role::text in ('admin', 'ops'))
  and lower(coalesce(p.email, '')) <> 'johnmatveyev@gmail.com';

-- Strip any admin/staff claims from auth app_metadata except the owner.
update auth.users
set raw_app_meta_data = raw_app_meta_data - 'role' - 'roles' - 'is_admin' - 'admin' - 'staff'
where lower(coalesce(email, '')) <> 'johnmatveyev@gmail.com'
  and raw_app_meta_data ?| array['role', 'roles', 'is_admin', 'admin', 'staff'];

-- ---------------------------------------------------------------------------
-- 2a. Caller checks on functions that took an arbitrary profile id
-- ---------------------------------------------------------------------------
create or replace function public.claim_signup_reward(p_profile_id uuid, p_source text, p_source_ref text default null::text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_source text;
  v_ref text;
begin
  -- Direct API calls must be the owner (or the server). Nested trigger calls
  -- (grant_referral_credits on trip completion) run as the function owner.
  if pg_trigger_depth() = 0
     and not public.is_service_role()
     and coalesce(auth.role(), '') in ('anon', 'authenticated')
     and (auth.uid() is null or auth.uid() is distinct from p_profile_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_profile_id is null then
    return jsonb_build_object('ok', false, 'reason', 'profile_required');
  end if;
  if p_source is null or p_source not in ('referral', 'social_promo') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_source');
  end if;

  insert into public.signup_reward_grants (profile_id, source, source_ref)
  values (p_profile_id, p_source, p_source_ref)
  on conflict (profile_id) do nothing;

  select source, source_ref into v_source, v_ref
  from public.signup_reward_grants
  where profile_id = p_profile_id;

  if v_source is null then
    return jsonb_build_object('ok', false, 'reason', 'claim_failed');
  end if;

  return jsonb_build_object(
    'ok', true,
    'claimed', v_source = p_source and v_ref is not distinct from p_source_ref,
    'source', v_source,
    'sourceRef', v_ref
  );
end;
$function$;

create or replace function public.women_only_pair_allowed(p_rider uuid, p_driver uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  rider_gender text := 'unspecified';
  driver_gender text := 'unspecified';
  rider_wants boolean := false;
  driver_wants boolean := false;
begin
  -- A direct caller may only ask about a pair they belong to; otherwise this
  -- leaks other users' gender / comfort settings.
  if pg_trigger_depth() = 0
     and not public.is_service_role()
     and coalesce(auth.role(), '') in ('anon', 'authenticated')
     and (auth.uid() is null or auth.uid() not in (coalesce(p_rider, auth.uid()), coalesce(p_driver, auth.uid()))) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_rider is null or p_driver is null then
    return true;
  end if;
  select coalesce(gender_identity, 'unspecified'), coalesce(women_only_matching, false)
    into rider_gender, rider_wants
  from public.profiles where id = p_rider;
  select coalesce(gender_identity, 'unspecified'), coalesce(women_only_matching, false)
    into driver_gender, driver_wants
  from public.profiles where id = p_driver;
  if rider_wants and rider_gender = 'woman' and driver_gender is distinct from 'woman' then
    return false;
  end if;
  if driver_wants and driver_gender = 'woman' and rider_gender is distinct from 'woman' then
    return false;
  end if;
  return true;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2b. EXECUTE grants + search_path for every SECURITY DEFINER function
--     (per-function rationale: docs/security/rpc-grants.md)
-- ---------------------------------------------------------------------------
revoke execute on function public.accept_scheduled_trip(p_trip_id uuid) from public, anon, authenticated;
grant execute on function public.accept_scheduled_trip(p_trip_id uuid) to authenticated, service_role;
alter function public.accept_scheduled_trip(p_trip_id uuid) set search_path = public, pg_temp;
revoke execute on function public.admin_read_driver_w9_tin(target uuid) from public, anon, authenticated;
grant execute on function public.admin_read_driver_w9_tin(target uuid) to service_role;
alter function public.admin_read_driver_w9_tin(target uuid) set search_path = public, extensions, pg_temp;
revoke execute on function public.affiliate_is_e2e_user(p_user uuid) from public, anon, authenticated;
grant execute on function public.affiliate_is_e2e_user(p_user uuid) to service_role;
alter function public.affiliate_is_e2e_user(p_user uuid) set search_path = public, pg_temp;
revoke execute on function public.affiliate_on_trip_completed() from public, anon, authenticated;
revoke execute on function public.affiliate_on_trip_completed() from service_role;
alter function public.affiliate_on_trip_completed() set search_path = public, pg_temp;
revoke execute on function public.affiliate_qualify_one(p_trip trips, p_user uuid, p_role text) from public, anon, authenticated;
grant execute on function public.affiliate_qualify_one(p_trip trips, p_user uuid, p_role text) to service_role;
alter function public.affiliate_qualify_one(p_trip trips, p_user uuid, p_role text) set search_path = public, pg_temp;
revoke execute on function public.affiliate_touch_signal() from public, anon, authenticated;
revoke execute on function public.affiliate_touch_signal() from service_role;
alter function public.affiliate_touch_signal() set search_path = public, pg_temp;
revoke execute on function public.airport_arrival_waves(p_airport text, p_hours integer, p_now timestamp with time zone) from public, anon, authenticated;
grant execute on function public.airport_arrival_waves(p_airport text, p_hours integer, p_now timestamp with time zone) to authenticated, service_role;
alter function public.airport_arrival_waves(p_airport text, p_hours integer, p_now timestamp with time zone) set search_path = public, pg_temp;
revoke execute on function public.apply_trip_driver_incentives(p_trip_id uuid) from public, anon, authenticated;
grant execute on function public.apply_trip_driver_incentives(p_trip_id uuid) to authenticated, service_role;
alter function public.apply_trip_driver_incentives(p_trip_id uuid) set search_path = public, pg_temp;
revoke execute on function public.apply_trip_driver_incentives_internal(p_trip_id uuid) from public, anon, authenticated;
grant execute on function public.apply_trip_driver_incentives_internal(p_trip_id uuid) to service_role;
alter function public.apply_trip_driver_incentives_internal(p_trip_id uuid) set search_path = public, pg_temp;
revoke execute on function public.apply_trip_flight_status(p_trip_id uuid, p_status jsonb) from public, anon, authenticated;
grant execute on function public.apply_trip_flight_status(p_trip_id uuid, p_status jsonb) to service_role;
alter function public.apply_trip_flight_status(p_trip_id uuid, p_status jsonb) set search_path = public, pg_temp;
revoke execute on function public.assert_driver_may_accept(p_driver uuid) from public, anon, authenticated;
grant execute on function public.assert_driver_may_accept(p_driver uuid) to service_role;
alter function public.assert_driver_may_accept(p_driver uuid) set search_path = public, pg_temp;
revoke execute on function public.assign_trip_pickup_code() from public, anon, authenticated;
revoke execute on function public.assign_trip_pickup_code() from service_role;
alter function public.assign_trip_pickup_code() set search_path = public, pg_temp;
revoke execute on function public.block_unapproved_driver_accept() from public, anon, authenticated;
revoke execute on function public.block_unapproved_driver_accept() from service_role;
alter function public.block_unapproved_driver_accept() set search_path = public, pg_temp;
revoke execute on function public.block_unpaid_airport_deposit_accept() from public, anon, authenticated;
revoke execute on function public.block_unpaid_airport_deposit_accept() from service_role;
alter function public.block_unpaid_airport_deposit_accept() set search_path = public, pg_temp;
revoke execute on function public.can_access_trip_messages(p_trip_id uuid) from public, anon, authenticated;
grant execute on function public.can_access_trip_messages(p_trip_id uuid) to authenticated, service_role;
alter function public.can_access_trip_messages(p_trip_id uuid) set search_path = public, pg_temp;
revoke execute on function public.can_activate_sos(p_trip_id uuid) from public, anon, authenticated;
grant execute on function public.can_activate_sos(p_trip_id uuid) to authenticated, service_role;
alter function public.can_activate_sos(p_trip_id uuid) set search_path = public, pg_temp;
revoke execute on function public.can_open_lost_item_report(p_trip_id uuid) from public, anon, authenticated;
grant execute on function public.can_open_lost_item_report(p_trip_id uuid) to authenticated, service_role;
alter function public.can_open_lost_item_report(p_trip_id uuid) set search_path = public, pg_temp;
revoke execute on function public.can_send_trip_message(p_trip_id uuid) from public, anon, authenticated;
grant execute on function public.can_send_trip_message(p_trip_id uuid) to authenticated, service_role;
alter function public.can_send_trip_message(p_trip_id uuid) set search_path = public, pg_temp;
revoke execute on function public.claim_driver_cashout(p_driver uuid, p_fee_bps integer, p_fee_min_cents integer) from public, anon, authenticated;
grant execute on function public.claim_driver_cashout(p_driver uuid, p_fee_bps integer, p_fee_min_cents integer) to service_role;
alter function public.claim_driver_cashout(p_driver uuid, p_fee_bps integer, p_fee_min_cents integer) set search_path = public, pg_temp;
revoke execute on function public.claim_rider_social_promo(p_code text) from public, anon, authenticated;
grant execute on function public.claim_rider_social_promo(p_code text) to authenticated, service_role;
alter function public.claim_rider_social_promo(p_code text) set search_path = public, pg_temp;
revoke execute on function public.claim_signup_reward(p_profile_id uuid, p_source text, p_source_ref text) from public, anon, authenticated;
grant execute on function public.claim_signup_reward(p_profile_id uuid, p_source text, p_source_ref text) to service_role;
alter function public.claim_signup_reward(p_profile_id uuid, p_source text, p_source_ref text) set search_path = public, pg_temp;
revoke execute on function public.community_matches(p_trip_id uuid) from public, anon, authenticated;
grant execute on function public.community_matches(p_trip_id uuid) to authenticated, service_role;
alter function public.community_matches(p_trip_id uuid) set search_path = public, pg_temp;
revoke execute on function public.counterpart_profile(target uuid) from public, anon, authenticated;
grant execute on function public.counterpart_profile(target uuid) to authenticated, service_role;
alter function public.counterpart_profile(target uuid) set search_path = public, pg_temp;
revoke execute on function public.deactivate_location_shares_on_trip_end() from public, anon, authenticated;
revoke execute on function public.deactivate_location_shares_on_trip_end() from service_role;
alter function public.deactivate_location_shares_on_trip_end() set search_path = public, pg_temp;
revoke execute on function public.driver_approval_ready(target uuid) from public, anon, authenticated;
grant execute on function public.driver_approval_ready(target uuid) to service_role;
alter function public.driver_approval_ready(target uuid) set search_path = public, pg_temp;
revoke execute on function public.driver_demand_cells(p_window_minutes integer, p_peak boolean) from public, anon, authenticated;
grant execute on function public.driver_demand_cells(p_window_minutes integer, p_peak boolean) to authenticated, service_role;
alter function public.driver_demand_cells(p_window_minutes integer, p_peak boolean) set search_path = public, pg_temp;
revoke execute on function public.driver_documents_clear_for_online(uid uuid) from public, anon, authenticated;
grant execute on function public.driver_documents_clear_for_online(uid uuid) to service_role;
alter function public.driver_documents_clear_for_online(uid uuid) set search_path = public, pg_temp;
revoke execute on function public.driver_incentive_summary(p_trip_id uuid) from public, anon, authenticated;
grant execute on function public.driver_incentive_summary(p_trip_id uuid) to service_role;
alter function public.driver_incentive_summary(p_trip_id uuid) set search_path = public, pg_temp;
revoke execute on function public.driver_inspection_blocks_online(uid uuid) from public, anon, authenticated;
grant execute on function public.driver_inspection_blocks_online(uid uuid) to service_role;
alter function public.driver_inspection_blocks_online(uid uuid) set search_path = public, pg_temp;
revoke execute on function public.driver_inspection_submitted(uid uuid) from public, anon, authenticated;
grant execute on function public.driver_inspection_submitted(uid uuid) to service_role;
alter function public.driver_inspection_submitted(uid uuid) set search_path = public, pg_temp;
revoke execute on function public.driver_is_approved(uid uuid) from public, anon, authenticated;
grant execute on function public.driver_is_approved(uid uuid) to service_role;
alter function public.driver_is_approved(uid uuid) set search_path = public, pg_temp;
revoke execute on function public.driver_rider_profile(target uuid) from public, anon, authenticated;
grant execute on function public.driver_rider_profile(target uuid) to authenticated, service_role;
alter function public.driver_rider_profile(target uuid) set search_path = public, pg_temp;
revoke execute on function public.driver_submission_ready(target uuid) from public, anon, authenticated;
grant execute on function public.driver_submission_ready(target uuid) to service_role;
alter function public.driver_submission_ready(target uuid) set search_path = public, pg_temp;
revoke execute on function public.driver_w9_encryption_key() from public, anon, authenticated;
revoke execute on function public.driver_w9_encryption_key() from service_role;
alter function public.driver_w9_encryption_key() set search_path = public, extensions, vault, pg_temp;
revoke execute on function public.enforce_driver_online_approval() from public, anon, authenticated;
revoke execute on function public.enforce_driver_online_approval() from service_role;
alter function public.enforce_driver_online_approval() set search_path = public, pg_temp;
revoke execute on function public.enforce_trip_approved_driver() from public, anon, authenticated;
revoke execute on function public.enforce_trip_approved_driver() from service_role;
alter function public.enforce_trip_approved_driver() set search_path = public, pg_temp;
revoke execute on function public.enqueue_trip_status_notices() from public, anon, authenticated;
revoke execute on function public.enqueue_trip_status_notices() from service_role;
alter function public.enqueue_trip_status_notices() set search_path = public, pg_temp;
revoke execute on function public.enqueue_trip_tip_notice() from public, anon, authenticated;
revoke execute on function public.enqueue_trip_tip_notice() from service_role;
alter function public.enqueue_trip_tip_notice() set search_path = public, pg_temp;
revoke execute on function public.ensure_rider_social_code() from public, anon, authenticated;
grant execute on function public.ensure_rider_social_code() to authenticated, service_role;
alter function public.ensure_rider_social_code() set search_path = public, pg_temp;
revoke execute on function public.get_live_share(p_token text) from public, anon, authenticated;
grant execute on function public.get_live_share(p_token text) to anon, authenticated, service_role;
alter function public.get_live_share(p_token text) set search_path = public, pg_temp;
revoke execute on function public.get_ride_demand(p_from timestamp with time zone, p_to timestamp with time zone, p_hour_start integer, p_hour_end integer) from public, anon, authenticated;
grant execute on function public.get_ride_demand(p_from timestamp with time zone, p_to timestamp with time zone, p_hour_start integer, p_hour_end integer) to authenticated, service_role;
alter function public.get_ride_demand(p_from timestamp with time zone, p_to timestamp with time zone, p_hour_start integer, p_hour_end integer) set search_path = public, pg_temp;
revoke execute on function public.grant_referral_credits(p_trip_id uuid, p_referrer_cents integer, p_referee_cents integer) from public, anon, authenticated;
grant execute on function public.grant_referral_credits(p_trip_id uuid, p_referrer_cents integer, p_referee_cents integer) to service_role;
alter function public.grant_referral_credits(p_trip_id uuid, p_referrer_cents integer, p_referee_cents integer) set search_path = public, pg_temp;
revoke execute on function public.grant_rider_social_for_trip(p_trip_id uuid) from public, anon, authenticated;
grant execute on function public.grant_rider_social_for_trip(p_trip_id uuid) to service_role;
alter function public.grant_rider_social_for_trip(p_trip_id uuid) set search_path = public, pg_temp;
revoke execute on function public.guard_driver_application() from public, anon, authenticated;
revoke execute on function public.guard_driver_application() from service_role;
alter function public.guard_driver_application() set search_path = public, pg_temp;
revoke execute on function public.guard_matching_accept() from public, anon, authenticated;
revoke execute on function public.guard_matching_accept() from service_role;
alter function public.guard_matching_accept() set search_path = public, pg_temp;
revoke execute on function public.guard_women_only_assignment() from public, anon, authenticated;
revoke execute on function public.guard_women_only_assignment() from service_role;
alter function public.guard_women_only_assignment() set search_path = public, pg_temp;
revoke execute on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated, service_role;
alter function public.is_admin() set search_path = public, pg_temp;
revoke execute on function public.is_driver_or_admin_role() from public, anon, authenticated;
grant execute on function public.is_driver_or_admin_role() to authenticated, service_role;
alter function public.is_driver_or_admin_role() set search_path = public, pg_temp;
revoke execute on function public.is_friend_ride_organizer(p_ride_id uuid) from public, anon, authenticated;
grant execute on function public.is_friend_ride_organizer(p_ride_id uuid) to authenticated, service_role;
alter function public.is_friend_ride_organizer(p_ride_id uuid) set search_path = public, pg_temp;
revoke execute on function public.is_friend_ride_participant(p_ride_id uuid) from public, anon, authenticated;
grant execute on function public.is_friend_ride_participant(p_ride_id uuid) to authenticated, service_role;
alter function public.is_friend_ride_participant(p_ride_id uuid) set search_path = public, pg_temp;
revoke execute on function public.is_incentive_admin() from public, anon, authenticated;
grant execute on function public.is_incentive_admin() to authenticated, service_role;
alter function public.is_incentive_admin() set search_path = public, pg_temp;
revoke execute on function public.is_support_staff() from public, anon, authenticated;
grant execute on function public.is_support_staff() to authenticated, service_role;
alter function public.is_support_staff() set search_path = public, pg_temp;
revoke execute on function public.list_approved_driver_ids(ids uuid[]) from public, anon, authenticated;
grant execute on function public.list_approved_driver_ids(ids uuid[]) to authenticated, service_role;
alter function public.list_approved_driver_ids(ids uuid[]) set search_path = public, pg_temp;
revoke execute on function public.list_driver_cards(ids uuid[]) from public, anon, authenticated;
grant execute on function public.list_driver_cards(ids uuid[]) to authenticated, service_role;
alter function public.list_driver_cards(ids uuid[]) set search_path = public, pg_temp;
revoke execute on function public.list_rider_driver_cards(ids uuid[]) from public, anon, authenticated;
grant execute on function public.list_rider_driver_cards(ids uuid[]) to authenticated, service_role;
alter function public.list_rider_driver_cards(ids uuid[]) set search_path = public, pg_temp;
revoke execute on function public.lost_found_can_report(p_trip uuid, p_reporter uuid, p_counterpart uuid) from public, anon, authenticated;
grant execute on function public.lost_found_can_report(p_trip uuid, p_reporter uuid, p_counterpart uuid) to authenticated, service_role;
alter function public.lost_found_can_report(p_trip uuid, p_reporter uuid, p_counterpart uuid) set search_path = public, pg_temp;
revoke execute on function public.lost_found_seed_claim_message() from public, anon, authenticated;
revoke execute on function public.lost_found_seed_claim_message() from service_role;
alter function public.lost_found_seed_claim_message() set search_path = public, pg_temp;
revoke execute on function public.matching_driver_offline() from public, anon, authenticated;
revoke execute on function public.matching_driver_offline() from service_role;
alter function public.matching_driver_offline() set search_path = public, pg_temp;
revoke execute on function public.matching_offer_passed() from public, anon, authenticated;
revoke execute on function public.matching_offer_passed() from service_role;
alter function public.matching_offer_passed() set search_path = public, pg_temp;
revoke execute on function public.merge_trip_metadata(p_trip_id uuid, p_patch jsonb, p_expected_statuses text[], p_new_status text, p_canceled_at timestamp with time zone, p_clear_claim boolean, p_require_unassigned boolean, p_require_unabandoned boolean) from public, anon, authenticated;
grant execute on function public.merge_trip_metadata(p_trip_id uuid, p_patch jsonb, p_expected_statuses text[], p_new_status text, p_canceled_at timestamp with time zone, p_clear_claim boolean, p_require_unassigned boolean, p_require_unabandoned boolean) to service_role;
alter function public.merge_trip_metadata(p_trip_id uuid, p_patch jsonb, p_expected_statuses text[], p_new_status text, p_canceled_at timestamp with time zone, p_clear_claim boolean, p_require_unassigned boolean, p_require_unabandoned boolean) set search_path = public, pg_temp;
revoke execute on function public.notify_admin_driver_application() from public, anon, authenticated;
revoke execute on function public.notify_admin_driver_application() from service_role;
alter function public.notify_admin_driver_application() set search_path = public, pg_temp;
revoke execute on function public.protect_profile_privileges() from public, anon, authenticated;
revoke execute on function public.protect_profile_privileges() from service_role;
alter function public.protect_profile_privileges() set search_path = public, pg_temp;
revoke execute on function public.public_ride_demand_coarse(p_from timestamp with time zone, p_to timestamp with time zone, p_hour_start integer, p_hour_end integer) from public, anon, authenticated;
grant execute on function public.public_ride_demand_coarse(p_from timestamp with time zone, p_to timestamp with time zone, p_hour_start integer, p_hour_end integer) to anon, authenticated, service_role;
alter function public.public_ride_demand_coarse(p_from timestamp with time zone, p_to timestamp with time zone, p_hour_start integer, p_hour_end integer) set search_path = public, pg_temp;
revoke execute on function public.refresh_profile_rating() from public, anon, authenticated;
revoke execute on function public.refresh_profile_rating() from service_role;
alter function public.refresh_profile_rating() set search_path = public, pg_temp;
revoke execute on function public.refresh_profile_rating_stats() from public, anon, authenticated;
revoke execute on function public.refresh_profile_rating_stats() from service_role;
alter function public.refresh_profile_rating_stats() set search_path = public, pg_temp;
revoke execute on function public.refresh_rider_credit_balance() from public, anon, authenticated;
revoke execute on function public.refresh_rider_credit_balance() from service_role;
alter function public.refresh_rider_credit_balance() set search_path = public, pg_temp;
revoke execute on function public.release_matching_offer(p_trip uuid, p_driver uuid, p_reason text) from public, anon, authenticated;
grant execute on function public.release_matching_offer(p_trip uuid, p_driver uuid, p_reason text) to service_role;
alter function public.release_matching_offer(p_trip uuid, p_driver uuid, p_reason text) set search_path = public, pg_temp;
revoke execute on function public.rental_driver_eligible(uid uuid) from public, anon, authenticated;
grant execute on function public.rental_driver_eligible(uid uuid) to authenticated, service_role;
alter function public.rental_driver_eligible(uid uuid) set search_path = public, pg_temp;
revoke execute on function public.rental_listing_requestable(lid uuid, pid uuid) from public, anon, authenticated;
grant execute on function public.rental_listing_requestable(lid uuid, pid uuid) to authenticated, service_role;
alter function public.rental_listing_requestable(lid uuid, pid uuid) set search_path = public, pg_temp;
revoke execute on function public.rental_partner_approved(uid uuid) from public, anon, authenticated;
grant execute on function public.rental_partner_approved(uid uuid) to authenticated, service_role;
alter function public.rental_partner_approved(uid uuid) set search_path = public, pg_temp;
revoke execute on function public.rental_partner_id_for(uid uuid) from public, anon, authenticated;
grant execute on function public.rental_partner_id_for(uid uuid) to authenticated, service_role;
alter function public.rental_partner_id_for(uid uuid) set search_path = public, pg_temp;
revoke execute on function public.rental_partner_is_approved(pid uuid) from public, anon, authenticated;
grant execute on function public.rental_partner_is_approved(pid uuid) to authenticated, service_role;
alter function public.rental_partner_is_approved(pid uuid) set search_path = public, pg_temp;
revoke execute on function public.rental_request_driver_card(p_request uuid) from public, anon, authenticated;
grant execute on function public.rental_request_driver_card(p_request uuid) to authenticated, service_role;
alter function public.rental_request_driver_card(p_request uuid) set search_path = public, pg_temp;
revoke execute on function public.rental_request_transition(p_request uuid, p_to text, p_start date, p_end date) from public, anon, authenticated;
grant execute on function public.rental_request_transition(p_request uuid, p_to text, p_start date, p_end date) to authenticated, service_role;
alter function public.rental_request_transition(p_request uuid, p_to text, p_start date, p_end date) set search_path = public, pg_temp;
revoke execute on function public.review_driver_application(target_profile uuid, decision text, reason text) from public, anon, authenticated;
grant execute on function public.review_driver_application(target_profile uuid, decision text, reason text) to authenticated, service_role;
alter function public.review_driver_application(target_profile uuid, decision text, reason text) set search_path = public, pg_temp;
revoke execute on function public.revoke_location_shares_on_trip_end() from public, anon, authenticated;
revoke execute on function public.revoke_location_shares_on_trip_end() from service_role;
alter function public.revoke_location_shares_on_trip_end() set search_path = public, pg_temp;
revoke execute on function public.rider_driver_profile(target uuid) from public, anon, authenticated;
grant execute on function public.rider_driver_profile(target uuid) to authenticated, service_role;
alter function public.rider_driver_profile(target uuid) set search_path = public, pg_temp;
revoke execute on function public.rider_first_completed_trip(p_uid uuid) from public, anon, authenticated;
grant execute on function public.rider_first_completed_trip(p_uid uuid) to service_role;
alter function public.rider_first_completed_trip(p_uid uuid) set search_path = public, pg_temp;
revoke execute on function public.rider_has_active_trip_with_driver(p_driver_id uuid) from public, anon, authenticated;
grant execute on function public.rider_has_active_trip_with_driver(p_driver_id uuid) to authenticated, service_role;
alter function public.rider_has_active_trip_with_driver(p_driver_id uuid) set search_path = public, pg_temp;
revoke execute on function public.rider_has_social_referral(p_profile uuid) from public, anon, authenticated;
grant execute on function public.rider_has_social_referral(p_profile uuid) to service_role;
alter function public.rider_has_social_referral(p_profile uuid) set search_path = public, pg_temp;
revoke execute on function public.save_driver_tax_info(legal_name text, tin text, tax_classification text) from public, anon, authenticated;
grant execute on function public.save_driver_tax_info(legal_name text, tin text, tax_classification text) to authenticated, service_role;
alter function public.save_driver_tax_info(legal_name text, tin text, tax_classification text) set search_path = public, pg_temp;
revoke execute on function public.save_driver_w9(legal_name text, tin text, tax_classification text, business_name text, address_line text, signature_name text, signed_on date) from public, anon, authenticated;
grant execute on function public.save_driver_w9(legal_name text, tin text, tax_classification text, business_name text, address_line text, signature_name text, signed_on date) to authenticated, service_role;
alter function public.save_driver_w9(legal_name text, tin text, tax_classification text, business_name text, address_line text, signature_name text, signed_on date) set search_path = public, pg_temp;
revoke execute on function public.save_driver_w9_record(legal_name text, business_name text, tax_classification text, address_line text, tin text, tin_kind text, certified boolean, signature_name text, signed_on date) from public, anon, authenticated;
grant execute on function public.save_driver_w9_record(legal_name text, business_name text, tax_classification text, address_line text, tin text, tin_kind text, certified boolean, signature_name text, signed_on date) to authenticated, service_role;
alter function public.save_driver_w9_record(legal_name text, business_name text, tax_classification text, address_line text, tin text, tin_kind text, certified boolean, signature_name text, signed_on date) set search_path = public, extensions, pg_temp;
revoke execute on function public.set_driver_mailing_address(address_line text, business_name text) from public, anon, authenticated;
grant execute on function public.set_driver_mailing_address(address_line text, business_name text) to authenticated, service_role;
alter function public.set_driver_mailing_address(address_line text, business_name text) set search_path = public, pg_temp;
revoke execute on function public.settle_driver_cashout(p_cashout uuid, p_ok boolean, p_status text, p_method text, p_transfer text, p_payout text, p_fallback text, p_error text) from public, anon, authenticated;
grant execute on function public.settle_driver_cashout(p_cashout uuid, p_ok boolean, p_status text, p_method text, p_transfer text, p_payout text, p_fallback text, p_error text) to service_role;
alter function public.settle_driver_cashout(p_cashout uuid, p_ok boolean, p_status text, p_method text, p_transfer text, p_payout text, p_fallback text, p_error text) set search_path = public, pg_temp;
revoke execute on function public.sign_driver_agreement(signature_name text) from public, anon, authenticated;
grant execute on function public.sign_driver_agreement(signature_name text) to authenticated, service_role;
alter function public.sign_driver_agreement(signature_name text) set search_path = public, pg_temp;
revoke execute on function public.stamp_driver_inspection_deadline() from public, anon, authenticated;
revoke execute on function public.stamp_driver_inspection_deadline() from service_role;
alter function public.stamp_driver_inspection_deadline() set search_path = public, pg_temp;
revoke execute on function public.stamp_scheduled_reminder(p_trip_id uuid, p_window text) from public, anon, authenticated;
grant execute on function public.stamp_scheduled_reminder(p_trip_id uuid, p_window text) to authenticated, service_role;
alter function public.stamp_scheduled_reminder(p_trip_id uuid, p_window text) set search_path = public, pg_temp;
revoke execute on function public.sync_driver_mileage_log() from public, anon, authenticated;
revoke execute on function public.sync_driver_mileage_log() from service_role;
alter function public.sync_driver_mileage_log() set search_path = public, pg_temp;
revoke execute on function public.sync_pickup_approach() from public, anon, authenticated;
revoke execute on function public.sync_pickup_approach() from service_role;
alter function public.sync_pickup_approach() set search_path = public, pg_temp;
revoke execute on function public.trg_apply_driver_incentives() from public, anon, authenticated;
revoke execute on function public.trg_apply_driver_incentives() from service_role;
alter function public.trg_apply_driver_incentives() set search_path = public, pg_temp;
revoke execute on function public.trg_payments_rider_social() from public, anon, authenticated;
revoke execute on function public.trg_payments_rider_social() from service_role;
alter function public.trg_payments_rider_social() set search_path = public, pg_temp;
revoke execute on function public.trg_trips_grant_referral_credits() from public, anon, authenticated;
revoke execute on function public.trg_trips_grant_referral_credits() from service_role;
alter function public.trg_trips_grant_referral_credits() set search_path = public, pg_temp;
revoke execute on function public.trg_trips_rider_social() from public, anon, authenticated;
revoke execute on function public.trg_trips_rider_social() from service_role;
alter function public.trg_trips_rider_social() set search_path = public, pg_temp;
revoke execute on function public.trip_lost_item_reports_before_write() from public, anon, authenticated;
revoke execute on function public.trip_lost_item_reports_before_write() from service_role;
alter function public.trip_lost_item_reports_before_write() set search_path = public, pg_temp;
revoke execute on function public.trip_messages_before_write() from public, anon, authenticated;
revoke execute on function public.trip_messages_before_write() from service_role;
alter function public.trip_messages_before_write() set search_path = public, pg_temp;
revoke execute on function public.trip_pickup_code_visible(p_trip_id uuid) from public, anon, authenticated;
grant execute on function public.trip_pickup_code_visible(p_trip_id uuid) to authenticated, service_role;
alter function public.trip_pickup_code_visible(p_trip_id uuid) set search_path = public, pg_temp;
revoke execute on function public.trip_wait_apply(p_trip_id uuid, p_action text, p_actor uuid) from public, anon, authenticated;
grant execute on function public.trip_wait_apply(p_trip_id uuid, p_action text, p_actor uuid) to service_role;
alter function public.trip_wait_apply(p_trip_id uuid, p_action text, p_actor uuid) set search_path = public, pg_temp;
revoke execute on function public.women_only_pair_allowed(p_rider uuid, p_driver uuid) from public, anon, authenticated;
grant execute on function public.women_only_pair_allowed(p_rider uuid, p_driver uuid) to authenticated, service_role;
alter function public.women_only_pair_allowed(p_rider uuid, p_driver uuid) set search_path = public, pg_temp;
revoke execute on function public.women_only_visible_trips(trip_ids uuid[]) from public, anon, authenticated;
grant execute on function public.women_only_visible_trips(trip_ids uuid[]) to authenticated, service_role;
alter function public.women_only_visible_trips(trip_ids uuid[]) set search_path = public, pg_temp;

-- New functions no longer default to anon EXECUTE.
alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;

-- ---------------------------------------------------------------------------
-- 2c. Mutable search_path (advisor 0011)
-- ---------------------------------------------------------------------------
alter function public.apply_credit_delta(p_user_id uuid, p_delta_cents integer, p_kind text, p_trip_id uuid, p_idempotency_key text) set search_path = public, pg_temp;
alter function public.block_unpaid_trip_close() set search_path = public, pg_temp;
alter function public.compute_wait_fee_cents(arrived timestamp with time zone, at_time timestamp with time zone) set search_path = public, pg_temp;
alter function public.driver_incentive_is_active(p driver_incentives, p_at timestamp with time zone, p_game_day boolean) set search_path = public, pg_temp;
alter function public.emergency_contacts_limit() set search_path = public, pg_temp;
alter function public.enforce_trip_wait_fees() set search_path = public, pg_temp;
alter function public.guard_admin_notification_update() set search_path = public, pg_temp;
alter function public.guard_driver_document_ai_review() set search_path = public, pg_temp;
alter function public.guard_driver_knowledge_quiz() set search_path = public, pg_temp;
alter function public.guard_driver_profile_photo_status() set search_path = public, pg_temp;
alter function public.is_service_role() set search_path = public, pg_temp;
alter function public.platform_fee_cents(amount_cents integer) set search_path = public, pg_temp;
alter function public.profile_standing(avg numeric, cnt integer) set search_path = public, pg_temp;
alter function public.protect_profile_referral_fields() set search_path = public, pg_temp;
alter function public.protect_profile_standing() set search_path = public, pg_temp;
alter function public.protect_trip_fare_cents() set search_path = public, pg_temp;
alter function public.protect_trip_tip_cents() set search_path = public, pg_temp;
alter function public.rider_first_name(p_full_name text) set search_path = public, pg_temp;
alter function public.rider_social_random_code(len integer) set search_path = public, pg_temp;
alter function public.set_updated_at() set search_path = public, pg_temp;
alter function public.touch_driver_payout_events() set search_path = public, pg_temp;
alter function public.touch_driver_w9() set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 3. RLS least privilege
-- ---------------------------------------------------------------------------
-- profiles: anon could read every column (email, phone, home/work lat-lng,
-- Stripe ids, credit balance) of any profile_privacy='public' row.
revoke all on table public.profiles from anon;
alter policy profiles_public_select on public.profiles to authenticated;

-- Live location shares: anon could list every active share token and read the
-- rider's GPS trail. The public page uses get_live_share(token) instead.
drop policy if exists location_shares_select_public_active on public.location_shares;
drop policy if exists location_points_select_public_active on public.location_points;
revoke all on table public.location_shares, public.location_points from anon;

-- Online drivers' live GPS was readable by anon.
alter policy driver_status_online_read on public.driver_status to authenticated;

-- Riders could insert their own payments rows (e.g. status='succeeded'), which
-- fires the rider-social reward trigger. Payments are written by the server.
drop policy if exists payments_rider_insert on public.payments;
revoke insert, update, delete on table public.payments from anon, authenticated;

-- Friend-ride policies called definer helpers for role PUBLIC (anon included).
alter policy friend_rides_select on public.friend_rides to authenticated;
alter policy friend_rides_organizer_all on public.friend_rides to authenticated;
alter policy friend_ride_participants_select on public.friend_ride_participants to authenticated;
alter policy friend_ride_participants_organizer_write on public.friend_ride_participants to authenticated;
alter policy friend_ride_participants_self_update on public.friend_ride_participants to authenticated;

-- driver_incentives: keep the public "active incentives" read for anon without
-- calling is_incentive_admin() as anon.
alter policy driver_incentives_read on public.driver_incentives to authenticated;
drop policy if exists driver_incentives_public_active on public.driver_incentives;
create policy driver_incentives_public_active on public.driver_incentives
  for select to anon using (active = true);

-- Every remaining PUBLIC-role policy that keys on auth.uid() matches nothing
-- for anon; scope it to authenticated so anon is not evaluated at all.
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and roles = array['public']::name[]
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%auth.uid()%'
  loop
    execute format('alter policy %I on %I.%I to authenticated', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- Server-only tables (RLS on, no policies): no client grants, explicit
-- service_role policy so the intent is visible (advisor 0008).
do $$
declare t text;
begin
  foreach t in array array[
    'affiliate_config','affiliate_payout_batches','agent_drafts','airport_wave_alerts',
    'ambassador_attributions','ambassador_codes','ambassador_payout_ledger','carpool_requests',
    'driver_action_receipts','driver_agreement_sign_links','driver_offer_alert_attempts',
    'driver_offer_alerts','driver_tax_secrets','expo_push_tickets','first_ride_grants',
    'flight_ingest_runs','inbound_agent_mail','student_email_otps','student_plan_email_optouts',
    'student_plan_referral_rewards','trip_status_notices','weekly_coupon_drops'
  ] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_service_role_only', t);
    execute format('create policy %I on public.%I for all to service_role using (true) with check (true)', t || '_service_role_only', t);
  end loop;
end $$;

commit;
