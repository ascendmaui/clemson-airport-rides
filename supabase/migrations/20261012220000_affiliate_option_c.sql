-- Option C commission config (additive). Updates affiliate_config in place and
-- replaces the qualify function so a rider's first completed fare must meet
-- rider_min_fare_cents ($15). Dollar amounts and partner-type bonuses come
-- from affiliate_config, seeded from shared/affiliates/config.js.
-- Partner-type bonuses are proposed defaults for John to confirm.

insert into public.affiliate_config (key, value)
values ('rates', jsonb_build_object(
  'plan', 'option_c',
  'placeholder', false,
  'multipliers_pending_confirmation', true,
  'multipliers_note', 'Proposed partner-type bonuses for John to confirm: campus groups 1.25x, local businesses 1.25x, creators 1.5x. Students stay at 1x.',
  'currency', 'usd',
  'rider_first_ride_cents', 400,
  'rider_min_fare_cents', 1500,
  'driver_first_trip_cents', 2000,
  'partner_type_bps', jsonb_build_object('student', 10000, 'campus_org', 12500, 'local_business', 12500, 'influencer', 15000),
  'hold_days', 14,
  'monthly_cap', 50,
  'min_payout_cents', 1000
))
on conflict (key) do update set
  value = public.affiliate_config.value || excluded.value,
  updated_at = now();

create or replace function public.affiliate_qualify_one(p_trip public.trips, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  att public.affiliate_attributions;
  aff public.affiliates;
  rates jsonb;
  prior int;
  dup boolean;
  v_phone text;
  counterparty uuid;
  amount int;
  cap int;
  month_count int;
  min_fare int;
begin
  if p_user is null then return; end if;
  select * into att from public.affiliate_attributions
    where referred_user_id = p_user and role = p_role and status = 'signed_up' for update;
  if not found then return; end if;
  select * into aff from public.affiliates where id = att.affiliate_id;

  if public.affiliate_is_e2e_user(p_user) then
    update public.affiliate_attributions set status = 'rejected', reject_reason = 'e2e_test' where id = att.id;
    return;
  end if;
  if coalesce((p_trip.metadata->>'e2e_test')::boolean, false)
     or public.affiliate_is_e2e_user(p_trip.rider_id) or public.affiliate_is_e2e_user(p_trip.driver_id) then
    return;
  end if;

  if p_role = 'rider' then
    select count(*) into prior from public.trips where rider_id = p_user and status = 'completed' and id <> p_trip.id;
    counterparty := p_trip.driver_id;
  else
    select count(*) into prior from public.trips where driver_id = p_user and status = 'completed' and id <> p_trip.id;
    counterparty := p_trip.rider_id;
  end if;
  if prior > 0 then
    update public.affiliate_attributions set status = 'rejected', reject_reason = 'not_first_trip', qualifying_trip_id = p_trip.id where id = att.id;
    return;
  end if;

  if aff.user_id is not null and (aff.user_id = p_user or aff.user_id = counterparty) then
    update public.affiliate_attributions set status = 'rejected', reject_reason = 'self_referral', qualifying_trip_id = p_trip.id where id = att.id;
    return;
  end if;

  select nullif(right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10), '') into v_phone from public.profiles where id = p_user;
  if v_phone is not null and v_phone = nullif(right(regexp_replace(coalesce(aff.phone, ''), '\D', '', 'g'), 10), '') then
    update public.affiliate_attributions set status = 'rejected', reject_reason = 'self_referral', qualifying_trip_id = p_trip.id where id = att.id;
    return;
  end if;

  select exists (
    select 1 from public.affiliate_attributions o
    where o.id <> att.id and o.status = 'qualified' and (
      (att.device_hash is not null and o.device_hash = att.device_hash)
      or (v_phone is not null and o.phone_norm = v_phone)
      or (att.payment_fingerprint is not null and o.payment_fingerprint = att.payment_fingerprint)
    )
  ) into dup;
  if dup then
    update public.affiliate_attributions set status = 'rejected', reject_reason = 'duplicate_device_phone_or_payment', phone_norm = v_phone, qualifying_trip_id = p_trip.id where id = att.id;
    return;
  end if;

  select value into rates from public.affiliate_config where key = 'rates';
  -- Fallback matches AFFILIATE_RATES_DEFAULTS.rider_min_fare_cents when the key is absent.
  min_fare := coalesce((rates->>'rider_min_fare_cents')::int, 1500);

  -- Option C: a rider qualifies only when the first completed fare is at least the configured minimum.
  -- A null fare stays signed_up so a later fare write can still qualify.
  if p_role = 'rider' then
    if p_trip.fare_cents is null then
      return;
    end if;
    if p_trip.fare_cents < min_fare then
      update public.affiliate_attributions
        set status = 'rejected', reject_reason = 'fare_below_minimum', qualifying_trip_id = p_trip.id, phone_norm = v_phone
        where id = att.id;
      return;
    end if;
  end if;

  update public.affiliate_attributions
    set status = 'qualified', qualified_at = now(), qualifying_trip_id = p_trip.id, phone_norm = v_phone
    where id = att.id;

  if aff.status <> 'active' then return; end if;

  amount := round(
    coalesce((rates->>case when p_role = 'driver' then 'driver_first_trip_cents' else 'rider_first_ride_cents' end)::numeric, 0)
    * coalesce((rates->'partner_type_bps'->>aff.partner_type)::numeric, 10000) / 10000
  );
  cap := coalesce((rates->>'monthly_cap')::int, 0);
  if cap > 0 then
    select count(*) into month_count from public.affiliate_ledger
      where affiliate_id = aff.id and kind in ('referral_rider','referral_driver') and amount_cents > 0
        and created_at >= date_trunc('month', now() at time zone 'America/New_York') at time zone 'America/New_York';
    if month_count >= cap then amount := 0; end if;
  end if;

  insert into public.affiliate_ledger (affiliate_id, attribution_id, kind, amount_cents, status, note)
  values (aff.id, att.id, case when p_role = 'driver' then 'referral_driver' else 'referral_rider' end,
          amount, case when amount > 0 then 'pending' else 'void' end,
          case when amount = 0 then 'monthly cap reached or zero rate' end)
  on conflict (attribution_id) do nothing;
end;
$$;

create or replace function public.affiliate_on_trip_completed()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'completed' and (
    old.status is distinct from 'completed'
    or new.fare_cents is distinct from old.fare_cents
  ) then
    begin
      perform public.affiliate_qualify_one(new, new.rider_id, 'rider');
      perform public.affiliate_qualify_one(new, new.driver_id, 'driver');
    exception when others then
      raise warning 'affiliate qualify failed for trip %: %', new.id, sqlerrm;
    end;
  end if;
  return null;
end;
$$;

drop trigger if exists trips_affiliate_qualify on public.trips;
create trigger trips_affiliate_qualify after update of status, fare_cents on public.trips
  for each row execute function public.affiliate_on_trip_completed();

revoke all on function public.affiliate_qualify_one(public.trips, uuid, text) from public, anon, authenticated;
revoke all on function public.affiliate_on_trip_completed() from public, anon, authenticated;
