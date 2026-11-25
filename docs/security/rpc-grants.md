# SECURITY DEFINER function grants (2026-10-14 lockdown)

Source of truth: `supabase/migrations/20261014233000_security_lockdown.sql`. Callers were found by grepping `.rpc('name')` across apps/rider, apps/driver, packages/rides-native, src (website) and server (service-role client).

| Function | Grant / reason |
|---|---|
| `accept_scheduled_trip` | authenticated: driver app (driverDesk.js), web scheduledRides.js; checks auth.uid() is the approved driver |
| `admin_read_driver_w9_tin` | service_role only (server/internal) |
| `affiliate_is_e2e_user` | service_role only (server/internal) |
| `affiliate_on_trip_completed` | trigger: no RPC grant |
| `affiliate_qualify_one` | service_role only (server/internal) |
| `affiliate_touch_signal` | trigger: no RPC grant |
| `airport_arrival_waves` | authenticated: rider/driver app flightStatus.js; aggregate flight arrivals only |
| `apply_trip_driver_incentives` | authenticated: web driverIncentives.js; requires auth.uid() = trip driver or incentive admin |
| `apply_trip_driver_incentives_internal` | service_role only (server/internal) |
| `apply_trip_flight_status` | service_role only (server/internal) |
| `assert_driver_may_accept` | service_role only (server/internal) |
| `assign_trip_pickup_code` | trigger: no RPC grant |
| `block_unapproved_driver_accept` | trigger: no RPC grant |
| `block_unpaid_airport_deposit_accept` | trigger: no RPC grant |
| `can_access_trip_messages` | authenticated: RLS helper (trip_messages, trip_lost_item_reports) |
| `can_activate_sos` | authenticated: RLS helper (sos_events) |
| `can_open_lost_item_report` | authenticated: RLS helper (trip_lost_item_reports) |
| `can_send_trip_message` | authenticated: RLS helper (trip_messages) |
| `claim_driver_cashout` | service_role only (server/internal) |
| `claim_rider_social_promo` | authenticated: rider app / web riderReferral; scoped to auth.uid() |
| `claim_signup_reward` | service_role only (server/internal) |
| `community_matches` | authenticated: rider app community.js; scoped to auth.uid() trip |
| `counterpart_profile` | authenticated: apps partyProfile.js; only the trip counterpart |
| `deactivate_location_shares_on_trip_end` | trigger: no RPC grant |
| `driver_approval_ready` | service_role only (server/internal) |
| `driver_demand_cells` | authenticated: driver app heat map; gated by is_driver_or_admin_role() |
| `driver_documents_clear_for_online` | service_role only (server/internal) |
| `driver_incentive_summary` | service_role only (server/internal) |
| `driver_inspection_blocks_online` | service_role only (server/internal) |
| `driver_inspection_submitted` | service_role only (server/internal) |
| `driver_is_approved` | service_role only (server/internal) |
| `driver_rider_profile` | authenticated: driver app partyProfile.js; only assigned rider |
| `driver_submission_ready` | service_role only (server/internal) |
| `driver_w9_encryption_key` | internal key accessor: owner only |
| `enforce_driver_online_approval` | trigger: no RPC grant |
| `enforce_trip_approved_driver` | trigger: no RPC grant |
| `enqueue_trip_status_notices` | trigger: no RPC grant |
| `enqueue_trip_tip_notice` | trigger: no RPC grant |
| `ensure_rider_social_code` | authenticated: rider app riderMoney.js; scoped to auth.uid() |
| `get_live_share` | anon+auth: Public live-location page; caller must hold the unguessable share token. |
| `get_ride_demand` | authenticated: apps busySpots.ts; aggregate demand only |
| `grant_referral_credits` | service_role only (server/internal) |
| `grant_rider_social_for_trip` | service_role only (server/internal) |
| `guard_driver_application` | trigger: no RPC grant |
| `guard_matching_accept` | trigger: no RPC grant |
| `guard_women_only_assignment` | trigger: no RPC grant |
| `is_admin` | authenticated: RLS helper + web riderReferral (returns caller own admin flag) |
| `is_driver_or_admin_role` | authenticated: RLS helper (trips, flight_arrivals) |
| `is_friend_ride_organizer` | authenticated: RLS helper (friend_ride_participants) |
| `is_friend_ride_participant` | authenticated: RLS helper (friend_rides) |
| `is_incentive_admin` | authenticated: RLS helper (driver_incentives, driver_earnings, incentive_*) |
| `is_support_staff` | authenticated: RLS helper (support_tickets) |
| `list_approved_driver_ids` | authenticated: apps drivers.js; returns ids only |
| `list_driver_cards` | authenticated: apps drivers.js; first name + vehicle of approved drivers only |
| `list_rider_driver_cards` | authenticated: apps drivers.js; first name + vehicle of approved drivers only |
| `lost_found_can_report` | authenticated: RLS helper (lost_found_reports) |
| `lost_found_seed_claim_message` | trigger: no RPC grant |
| `matching_driver_offline` | trigger: no RPC grant |
| `matching_offer_passed` | trigger: no RPC grant |
| `merge_trip_metadata` | service_role only (server/internal) |
| `notify_admin_driver_application` | trigger: no RPC grant |
| `protect_profile_privileges` | trigger: no RPC grant |
| `public_ride_demand_coarse` | anon+auth: Marketing-site coarse demand buckets; aggregate counts only, no rider data. |
| `refresh_profile_rating` | trigger: no RPC grant |
| `refresh_profile_rating_stats` | trigger: no RPC grant |
| `refresh_rider_credit_balance` | trigger: no RPC grant |
| `release_matching_offer` | service_role only (server/internal) |
| `rental_driver_eligible` | authenticated: RLS helper (rental_*) |
| `rental_listing_requestable` | authenticated: RLS helper (rental_requests) |
| `rental_partner_approved` | authenticated: RLS helper (rental_listings) |
| `rental_partner_id_for` | authenticated: RLS helper (rental_*) |
| `rental_partner_is_approved` | authenticated: RLS helper (rental_listings) |
| `rental_request_driver_card` | authenticated: rental partner flow; checks auth.uid() is partner or admin |
| `rental_request_transition` | authenticated: rental partner flow; checks auth.uid() is party or admin |
| `review_driver_application` | authenticated: web admin desk (driverOnboarding.js); requires is_admin() |
| `revoke_location_shares_on_trip_end` | trigger: no RPC grant |
| `rider_driver_profile` | authenticated: rider app tripWatch.ts / partyProfile.js; only assigned driver |
| `rider_first_completed_trip` | service_role only (server/internal) |
| `rider_has_active_trip_with_driver` | authenticated: RLS helper (driver_status) |
| `rider_has_social_referral` | service_role only (server/internal) |
| `save_driver_tax_info` | authenticated: driver app onboarding; writes auth.uid() row only |
| `save_driver_w9` | authenticated: driver app onboarding; writes auth.uid() row only |
| `save_driver_w9_record` | authenticated: driver app driverW9Client.js; writes auth.uid() row only |
| `set_driver_mailing_address` | authenticated: web driverOnboarding.js; writes auth.uid() row only |
| `settle_driver_cashout` | service_role only (server/internal) |
| `sign_driver_agreement` | authenticated: driver app onboarding; signs as auth.uid() only |
| `stamp_driver_inspection_deadline` | trigger: no RPC grant |
| `stamp_scheduled_reminder` | authenticated: web scheduledRides.js; requires auth.uid() is trip rider |
| `sync_driver_mileage_log` | trigger: no RPC grant |
| `sync_pickup_approach` | trigger: no RPC grant |
| `trg_apply_driver_incentives` | trigger: no RPC grant |
| `trg_payments_rider_social` | trigger: no RPC grant |
| `trg_trips_grant_referral_credits` | trigger: no RPC grant |
| `trg_trips_rider_social` | trigger: no RPC grant |
| `trip_lost_item_reports_before_write` | trigger: no RPC grant |
| `trip_messages_before_write` | trigger: no RPC grant |
| `trip_pickup_code_visible` | authenticated: RLS helper (trip_pickup_codes) |
| `trip_wait_apply` | service_role only (server/internal) |
| `women_only_pair_allowed` | authenticated: driver app comfortPreference.js + server; caller must be one of the pair (guard added) |
| `women_only_visible_trips` | authenticated: driver app comfortPreference.js; scoped to auth.uid() |

## Promo campaign codes (20261015160000, not yet applied)

Source: `supabase/migrations/20261015160000_promo_campaign_codes.sql`. Tables `promo_campaign_codes`, `promo_code_redemptions`, `promo_code_admin_events`, `promo_code_attempts`, `promo_auto_settings`, `promo_email_outbox` have RLS on and no anon/authenticated grants; only the server (service role) reads or writes them.

| Function | Grant / reason |
|---|---|
| `promo_check_code` | service_role only: server/promoCodes.js (`/api/promo/check`) |
| `promo_claim_code` | service_role only: server/promoCodes.js (`/api/promo/claim`, sign-up) |
| `promo_reserve_for_trip` | service_role only: request-driver, row-locked, idempotent on trip_id |
| `promo_release_for_trip` | service_role only: request-driver failure paths |
| `promo_finalize_for_trip` | service_role only: tripSettle after capture |
| `promo_issue_auto_code` | service_role only: also called by the profiles triggers (sign-up, first card, $50 credits) |
| `promo_claim_email_batch` | service_role only: server/promoEmailOutbox.js (minute tick), FOR UPDATE SKIP LOCKED lease |
| `promo_compute_discount`, `promo_attempts_blocked`, `promo__fail`, `promo__unusable_reason`, `promo__group_reason`, `promo__random_code` | service_role only: internal helpers |
| `promo_trip_status_sync`, `promo_campaign_code_unique_guard`, `promo_profile_auto_issue`, `promo_redemption_terminal_guard` | trigger: no RPC grant |
