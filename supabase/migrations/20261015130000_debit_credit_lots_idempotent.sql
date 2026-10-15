-- Atomic, idempotent debits of specific credit lots.
-- Applied to project awktabuhijrshmsmagpq (Clemson Rides).
--
-- Why
--   server/creditLots.js debitLots() updated lots one by one from Node with a
--   compare-and-swap and no idempotency key. A webhook + reconcile pair, or a
--   retried friend-share/airport charge, could debit the same purchase twice,
--   and a failure half-way relied on a best-effort JS restore.
--
-- What (additive: one new function, no table or balance change)
--   debit_credit_lots(profile, debits jsonb, trip, note, idempotency_key)
--   - same per-rider advisory lock as apply_credit_delta
--   - a used key returns duplicate; a reused key with another rider or total
--     returns idempotency_conflict
--   - every lot is locked FOR UPDATE and checked (owner, available, enough
--     remaining); any failure raises, so nothing is applied (all or nothing)
--   - writes rider_credit_ledger redemption rows (with discount) and one
--     wallet_ledger journal row (kind lot_debit, delta = -total)
--   - service_role only
--
-- Rollback
--   drop function public.debit_credit_lots(uuid, jsonb, uuid, text, text);
--   (server/creditLots.js then fails closed on debits until reverted.)

create or replace function public.debit_credit_lots(
  p_profile_id uuid,
  p_debits jsonb,
  p_trip_id uuid default null,
  p_note text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_prior public.wallet_ledger%rowtype;
  v_item jsonb;
  v_lot record;
  v_cents bigint;
  v_disc bigint;
  v_total bigint := 0;
  v_balance bigint;
  v_after bigint;
begin
  if p_profile_id is null or p_debits is null or jsonb_typeof(p_debits) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'invalid_request', 'balance_cents', 0);
  end if;

  for v_item in select value from jsonb_array_elements(p_debits) loop
    v_cents := nullif(v_item->>'debit_cents', '')::bigint;
    if v_cents is null or v_cents < 0 or v_cents > 1000000000 or nullif(v_item->>'lot_id', '') is null then
      return jsonb_build_object('ok', false, 'code', 'invalid_request', 'balance_cents', 0);
    end if;
    v_total := v_total + v_cents;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended('rider_credit:' || p_profile_id::text, 0));

  select coalesce(sum(remaining_cents), 0) into v_balance
  from public.rider_credit_lots
  where profile_id = p_profile_id and status = 'available' and remaining_cents > 0;

  if v_key is not null then
    select * into v_prior from public.wallet_ledger where idempotency_key = v_key;
    if found then
      if v_prior.user_id <> p_profile_id or v_prior.delta_cents <> -v_total then
        return jsonb_build_object('ok', false, 'code', 'idempotency_conflict', 'balance_cents', v_balance);
      end if;
      return jsonb_build_object('ok', true, 'duplicate', true, 'balance_cents', v_balance);
    end if;
  end if;

  if v_total = 0 then
    return jsonb_build_object('ok', true, 'duplicate', false, 'balance_cents', v_balance);
  end if;

  for v_item in select value from jsonb_array_elements(p_debits) loop
    v_cents := (v_item->>'debit_cents')::bigint;
    continue when v_cents = 0;
    v_disc := greatest(coalesce(nullif(v_item->>'discount_cents', '')::bigint, 0), 0);
    select id, profile_id, remaining_cents, status into v_lot
    from public.rider_credit_lots
    where id = (v_item->>'lot_id')::uuid
    for update;
    if not found or v_lot.profile_id <> p_profile_id then
      raise exception 'credit_lot_missing';
    end if;
    if v_lot.status <> 'available' or v_lot.remaining_cents < v_cents then
      raise exception 'credit_balance_changed';
    end if;
    update public.rider_credit_lots
    set remaining_cents = remaining_cents - v_cents,
        status = case when remaining_cents - v_cents = 0 then 'exhausted' else 'available' end
    where id = v_lot.id;
    insert into public.rider_credit_ledger (profile_id, lot_id, kind, amount_cents, discount_cents, trip_id, note)
    values (p_profile_id, v_lot.id, 'redemption', v_cents, v_disc, p_trip_id, p_note);
  end loop;

  select coalesce(sum(remaining_cents), 0) into v_after
  from public.rider_credit_lots
  where profile_id = p_profile_id and status = 'available' and remaining_cents > 0;

  insert into public.wallet_ledger (user_id, delta_cents, balance_after, trip_id, kind, idempotency_key)
  values (p_profile_id, -v_total, v_after, p_trip_id, 'lot_debit', v_key);

  return jsonb_build_object('ok', true, 'duplicate', false, 'balance_cents', v_after);
end;
$$;

revoke all on function public.debit_credit_lots(uuid, jsonb, uuid, text, text) from public, anon, authenticated;
grant execute on function public.debit_credit_lots(uuid, jsonb, uuid, text, text) to service_role;
