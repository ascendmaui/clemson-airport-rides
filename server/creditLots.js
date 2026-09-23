/**
 * Prepaid credit lots + 20/80 charge rows.
 * Purchase is a liability (platform fee 0). Redemption takes 20% of the
 * discounted value the credits paid and leaves 80% as driver earnings.
 */
import {
  findCreditPack,
  splitPlatformFee,
  applyCreditLots,
  finalizeSettlement,
} from '../src/lib/fareRates.js'

export async function loadCreditLots(sb, profileId) {
  if (!profileId) return []
  const { data, error } = await sb
    .from('rider_credit_lots')
    .select('id, pack_id, load_cents, discount_bps, remaining_cents, status, created_at')
    .eq('profile_id', profileId)
    .eq('status', 'available')
    .gt('remaining_cents', 0)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data || []).map((row) => ({
    id: row.id,
    packId: row.pack_id,
    loadCents: row.load_cents,
    discountBps: row.discount_bps,
    remainingCents: row.remaining_cents,
    createdAt: row.created_at,
  }))
}

export async function creditBalanceCents(sb, profileId) {
  const lots = await loadCreditLots(sb, profileId)
  return lots.reduce((sum, lot) => sum + lot.remainingCents, 0)
}

export async function planSettlement(sb, { profileId, fareCents, useCredits }) {
  const fare = Math.max(0, Math.round(Number(fareCents) || 0))
  if (!useCredits || !profileId || fare <= 0) {
    return finalizeSettlement({
      fareBeforeCreditsCents: fare,
      creditsDebitedCents: 0,
      creditDiscountCents: 0,
      cashCents: fare,
      riderPaysCents: fare,
      debits: [],
    })
  }
  const lots = await loadCreditLots(sb, profileId)
  return finalizeSettlement(applyCreditLots(fare, lots))
}

async function writeLedger(sb, row) {
  const { error } = await sb.from('rider_credit_ledger').insert(row)
  if (error) console.error('[rider_credit_ledger]', error.message)
}

export async function debitLots(sb, { profileId, debits, note, tripId }) {
  const applied = []
  try {
    for (const debit of debits || []) {
      if (!debit?.lotId || !debit.debitCents) continue
      const { data: lot, error } = await sb
        .from('rider_credit_lots')
        .select('id, remaining_cents, profile_id')
        .eq('id', debit.lotId)
        .single()
      if (error || !lot || lot.profile_id !== profileId) {
        throw new Error('Credit lot missing')
      }
      if (lot.remaining_cents < debit.debitCents) {
        throw new Error('Credit balance changed — retry the charge')
      }
      const next = lot.remaining_cents - debit.debitCents
      const { data: updated, error: upErr } = await sb
        .from('rider_credit_lots')
        .update({
          remaining_cents: next,
          status: next === 0 ? 'exhausted' : 'available',
        })
        .eq('id', lot.id)
        .eq('remaining_cents', lot.remaining_cents)
        .select('id')
      if (upErr || !updated?.length) throw new Error('Credit balance changed — retry the charge')
      await writeLedger(sb, {
        profile_id: profileId,
        lot_id: lot.id,
        kind: 'redemption',
        amount_cents: debit.debitCents,
        discount_cents: debit.discountCents || 0,
        trip_id: tripId || null,
        note: note || null,
      })
      applied.push(debit)
    }
    return applied
  } catch (err) {
    if (applied.length) {
      await restoreLots(sb, { profileId, debits: applied, note: `revert:${note || 'debit'}` })
    }
    throw err
  }
}

export async function restoreLots(sb, { profileId, debits, note }) {
  for (const debit of debits || []) {
    if (!debit?.lotId || !debit.debitCents) continue
    const { data: lot } = await sb
      .from('rider_credit_lots')
      .select('remaining_cents')
      .eq('id', debit.lotId)
      .maybeSingle()
    if (!lot) continue
    const next = lot.remaining_cents + debit.debitCents
    await sb
      .from('rider_credit_lots')
      .update({ remaining_cents: next, status: 'available' })
      .eq('id', debit.lotId)
    await writeLedger(sb, {
      profile_id: profileId,
      lot_id: debit.lotId,
      kind: 'refund',
      amount_cents: debit.debitCents,
      discount_cents: debit.discountCents || 0,
      note: note || 'restore',
    })
  }
}

/**
 * @param {object} fields
 * kind credit_purchase records the cash inflow with platform/driver 0
 * (earned later on redemption). Every other kind takes 20/80 of amountCents.
 */
export async function insertChargePayment(sb, {
  riderId,
  tripId = null,
  kind,
  amountCents,
  stripePaymentIntentId = null,
  status = 'succeeded',
  metadata = {},
}) {
  const amount = Math.max(0, Math.round(Number(amountCents) || 0))
  if (!riderId || amount <= 0) return null
  const split = kind === 'credit_purchase'
    ? { platformFeeCents: 0, driverEarningsCents: 0, amountCents: amount }
    : splitPlatformFee(amount)
  const { data, error } = await sb
    .from('payments')
    .insert({
      trip_id: tripId,
      rider_id: riderId,
      stripe_payment_intent_id: stripePaymentIntentId,
      kind,
      amount_cents: split.amountCents,
      platform_fee_cents: split.platformFeeCents,
      driver_earnings_cents: split.driverEarningsCents,
      status,
      metadata,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return { id: data.id, ...split }
}

export async function grantCreditPack(sb, {
  profileId,
  packId,
  stripePaymentIntentId = null,
  stripeCheckoutSessionId = null,
}) {
  const pack = findCreditPack(packId)
  if (!pack) throw new Error('Unknown credit pack')
  if (!profileId) throw new Error('profile required')

  if (stripePaymentIntentId) {
    const { data: existing } = await sb
      .from('rider_credit_lots')
      .select('id')
      .eq('stripe_payment_intent_id', stripePaymentIntentId)
      .maybeSingle()
    if (existing?.id) return { already: true, lotId: existing.id, pack }
  }

  const { data, error } = await sb
    .from('rider_credit_lots')
    .insert({
      profile_id: profileId,
      pack_id: pack.id,
      load_cents: pack.loadCents,
      discount_bps: pack.discountBps,
      remaining_cents: pack.loadCents,
      stripe_payment_intent_id: stripePaymentIntentId,
      stripe_checkout_session_id: stripeCheckoutSessionId,
      status: 'available',
    })
    .select('id')
    .single()
  if (error) {
    if (String(error.code) === '23505') return { already: true, pack }
    throw new Error(error.message)
  }

  await writeLedger(sb, {
    profile_id: profileId,
    lot_id: data.id,
    kind: 'purchase',
    amount_cents: pack.loadCents,
    discount_cents: 0,
    note: stripeCheckoutSessionId || stripePaymentIntentId || pack.id,
  })

  await insertChargePayment(sb, {
    riderId: profileId,
    kind: 'credit_purchase',
    amountCents: pack.loadCents,
    stripePaymentIntentId,
    metadata: {
      pack_id: pack.id,
      discount_bps: pack.discountBps,
      liability: true,
    },
  })

  return { already: false, lotId: data.id, pack }
}

export async function loadGameDayMultiplier(sb, at = new Date()) {
  const iso = (at instanceof Date ? at : new Date(at)).toISOString()
  const { data, error } = await sb
    .from('game_day_events')
    .select('id, title, surge_multiplier, pickup_zone_label')
    .eq('active', true)
    .lte('starts_at', iso)
    .gte('ends_at', iso)
    .order('surge_multiplier', { ascending: false })
    .limit(1)
  if (error || !data?.length) return { multiplier: null, event: null }
  const event = data[0]
  const multiplier = Number(event.surge_multiplier)
  return {
    multiplier: Number.isFinite(multiplier) ? multiplier : null,
    event,
  }
}
