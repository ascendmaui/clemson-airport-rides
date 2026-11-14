-- Widen promo_campaign_codes code length check constraint to 24 characters
-- and upsert the official Clemson Game-Day promotion ILOVECLEMSONRIDES
-- (50% off first eligible ride, Nov 13–14, 2026 Eastern Time).

do $$
declare
  v_con name;
begin
  if to_regclass('public.promo_campaign_codes') is not null then
    for v_con in
      select conname
      from pg_constraint
      where conrelid = 'public.promo_campaign_codes'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) like '%code ~%'
    loop
      execute format('alter table public.promo_campaign_codes drop constraint %I', v_con);
    end loop;

    alter table public.promo_campaign_codes
      add constraint promo_campaign_codes_code_format
      check (code ~ '^[A-Z0-9]{4,24}$');

    insert into public.promo_campaign_codes (
      code,
      side,
      discount_type,
      percent_off_bps,
      amount_off_cents,
      max_discount_cents,
      min_trip_cents,
      starts_at,
      expires_at,
      max_redemptions,
      per_account_limit,
      limit_per_device,
      limit_per_card,
      active,
      public_listing,
      campaign,
      notes,
      source
    ) values (
      'ILOVECLEMSONRIDES',
      'rider',
      'percent',
      5000,
      0,
      null,
      0,
      '2026-11-13T00:00:00-05:00'::timestamptz,
      '2026-11-14T23:59:59-05:00'::timestamptz,
      1,
      1,
      true,
      true,
      true,
      true,
      'Clemson Game Day 2026',
      '50% off customer first eligible ride, Nov 13-14, 2026 ET',
      'admin'
    )
    on conflict (code) do update set
      side = excluded.side,
      discount_type = excluded.discount_type,
      percent_off_bps = excluded.percent_off_bps,
      amount_off_cents = excluded.amount_off_cents,
      max_discount_cents = excluded.max_discount_cents,
      min_trip_cents = excluded.min_trip_cents,
      starts_at = excluded.starts_at,
      expires_at = excluded.expires_at,
      limit_per_device = excluded.limit_per_device,
      limit_per_card = excluded.limit_per_card,
      active = excluded.active,
      public_listing = excluded.public_listing,
      campaign = excluded.campaign,
      notes = excluded.notes,
      updated_at = now();
  end if;
end;
$$;
