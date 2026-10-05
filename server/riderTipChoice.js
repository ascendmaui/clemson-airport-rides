/**
 * Rider tip choice after a completed trip.
 * Preset amounts come from the stored fare. A custom amount is the dollars
 * the rider typed, priced and checked here. Client fare, deposit, amount,
 * total, isStudent, and tip cents are ignored. A positive choice is billed
 * by the tip charge module against a saved card. This file does not name
 * the card processor. No card leaves the completed trip unchanged.
 */
import { chargeSavedTip } from './tipCharge.js'

export const TIP_MIN_CENTS = 100
export const TIP_MAX_CENTS = 10000

const PERCENTS = [15, 20, 25]
const NO_FARE_CENTS = [200, 300, 500]
const LOW_FARE_CENTS = [100, 200, 500]
const FARE_CAP_CENTS = Math.floor(TIP_MAX_CENTS / 0.25)

const CLIENT_MONEY_KEYS = [
  'tipCents',
  'tip_cents',
  'amountCents',
  'amount_cents',
  'amount',
  'total',
  'fare',
  'fareCents',
  'fare_cents',
  'deposit',
  'depositCents',
  'deposit_cents',
  'isStudent',
  'is_student',
  'custom',
  'customCents',
  'custom_cents',
]

export const CUSTOM_TIP_EMPTY = 'Enter a tip amount'
export const CUSTOM_TIP_NEGATIVE = 'Tip amount cannot be negative'
export const CUSTOM_TIP_RANGE = 'Enter a tip between $1 and $100'
export const CUSTOM_TIP_FORMAT = 'Enter a tip amount in dollars, like 4.50'

function finiteFare(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.round(n))
}

function percentOfFare(fare, percent) {
  return Math.round((fare * percent) / 100)
}

function strictlyIncreasing(amounts) {
  return amounts.every((n, i) => i === 0 || n > amounts[i - 1])
}

function flatPresets(amounts, basis) {
  return {
    basis,
    fareCents: basis === 'no_fare' ? null : undefined,
    popularId: `flat-${amounts[1]}`,
    presets: amounts.map((cents, index) => ({
      id: `flat-${cents}`,
      percent: null,
      cents,
      popular: index === 1,
    })),
  }
}

/**
 * Server prices for the tip screen.
 * Percent of the stored fare when those amounts stay distinct.
 * Fixed amounts when there is no fare, or when a small fare would collapse.
 */
export function priceTipPresets(fareCents) {
  const fare = finiteFare(fareCents)
  if (fare == null || fare <= 0) {
    const priced = flatPresets(NO_FARE_CENTS, 'no_fare')
    priced.fareCents = fare
    return priced
  }
  const basisFare = Math.min(fare, FARE_CAP_CENTS)
  const amounts = PERCENTS.map((percent) => Math.min(TIP_MAX_CENTS, percentOfFare(basisFare, percent)))
  const percentFits = amounts.every((cents) => cents >= TIP_MIN_CENTS) && strictlyIncreasing(amounts)
  if (!percentFits) {
    const priced = flatPresets(LOW_FARE_CENTS, 'low_fare')
    priced.fareCents = fare
    return priced
  }
  return {
    basis: 'percent',
    fareCents: fare,
    popularId: 'pct-20',
    presets: PERCENTS.map((percent, index) => ({
      id: `pct-${percent}`,
      percent,
      cents: amounts[index],
      popular: percent === 20,
    })),
  }
}

/**
 * Price a typed custom tip. The stored cents come from this check.
 * Empty, negative, and amounts outside $1–$100 are rejected.
 */
export function priceCustomTip(raw) {
  if (raw == null) return { ok: false, error: CUSTOM_TIP_EMPTY }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { ok: false, error: CUSTOM_TIP_FORMAT }
    if (raw < 0) return { ok: false, error: CUSTOM_TIP_NEGATIVE }
    const cents = Math.round(raw * 100)
    if (Math.abs(raw - cents / 100) > 0.001) return { ok: false, error: CUSTOM_TIP_FORMAT }
    return customCentsResult(cents)
  }
  if (typeof raw !== 'string') return { ok: false, error: CUSTOM_TIP_FORMAT }

  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, error: CUSTOM_TIP_EMPTY }
  if (trimmed.startsWith('-') || trimmed.startsWith('-$')) {
    return { ok: false, error: CUSTOM_TIP_NEGATIVE }
  }
  if (trimmed.length > 16) return { ok: false, error: CUSTOM_TIP_RANGE }

  let cleaned = trimmed
  if (cleaned.startsWith('$')) cleaned = cleaned.slice(1).trim()
  if (!cleaned) return { ok: false, error: CUSTOM_TIP_EMPTY }
  if (cleaned.startsWith('-')) return { ok: false, error: CUSTOM_TIP_NEGATIVE }
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return { ok: false, error: CUSTOM_TIP_FORMAT }

  const [whole, frac = ''] = cleaned.split('.')
  const dollars = Number(whole)
  if (!Number.isSafeInteger(dollars)) return { ok: false, error: CUSTOM_TIP_RANGE }
  const cents = dollars * 100 + Number((frac + '00').slice(0, 2))
  return customCentsResult(cents)
}

function customCentsResult(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    return { ok: false, error: cents < 0 ? CUSTOM_TIP_NEGATIVE : CUSTOM_TIP_RANGE }
  }
  if (cents < TIP_MIN_CENTS || cents > TIP_MAX_CENTS) {
    return { ok: false, error: CUSTOM_TIP_RANGE }
  }
  return { ok: true, cents }
}

function choiceRecord(fields) {
  return {
    id: fields.id,
    tipCents: fields.tipCents,
    percent: fields.percent,
    skipped: fields.skipped,
    charged: false,
    chargeStatus: 'not_wired',
  }
}

export function resolveTipChoice(fareCents, choiceId, customDollars) {
  if (choiceId === 'skip') {
    return {
      ok: true,
      priced: priceTipPresets(fareCents),
      choice: choiceRecord({
        id: 'skip',
        tipCents: 0,
        percent: null,
        skipped: true,
      }),
    }
  }
  const priced = priceTipPresets(fareCents)
  if (choiceId === 'custom') {
    const custom = priceCustomTip(customDollars)
    if (!custom.ok) return custom
    return {
      ok: true,
      priced,
      choice: choiceRecord({
        id: 'custom',
        tipCents: custom.cents,
        percent: null,
        skipped: false,
      }),
    }
  }
  const preset = priced.presets.find((row) => row.id === choiceId)
  if (!preset) {
    return { ok: false, error: 'Choose a tip from the list or skip' }
  }
  return {
    ok: true,
    priced,
    choice: choiceRecord({
      id: preset.id,
      tipCents: preset.cents,
      percent: preset.percent,
      skipped: false,
    }),
  }
}

function sameRecordedChoice(existing, next) {
  if (existing.id !== next.id) return false
  if (next.id !== 'custom') return true
  return Math.round(Number(existing.tipCents) || 0) === next.tipCents
}

function metadataObject(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {}
  return metadata
}

export function readRiderTipChoice(metadata) {
  const choice = metadataObject(metadata).rider_tip_choice
  if (!choice || typeof choice !== 'object' || Array.isArray(choice)) return null
  return choice
}

function publicChoice(choice) {
  if (!choice) return null
  const tipCents = Math.max(0, Math.round(Number(choice.tipCents) || 0))
  const charged = choice.charged === true || choice.chargeStatus === 'charged'
  return {
    id: choice.id || null,
    tipCents,
    percent: choice.percent == null ? null : Number(choice.percent),
    skipped: Boolean(choice.skipped),
    charged,
    chargeStatus: choice.chargeStatus || (charged ? 'charged' : 'not_wired'),
    recordedAt: choice.recordedAt || null,
  }
}

function chargedTipCents(trip) {
  const n = Number(trip?.tip_cents)
  if (Number.isFinite(n) && n > 0) return Math.round(n)
  const choice = readRiderTipChoice(trip?.metadata)
  if (choice?.charged === true || choice?.chargeStatus === 'charged') {
    return Math.max(0, Math.round(Number(choice.tipCents) || 0))
  }
  return 0
}

function choiceIdFrom(body) {
  if (typeof body?.choiceId === 'string') return body.choiceId
  if (typeof body?.choice === 'string') return body.choice
  return ''
}

function tripIdFrom(body) {
  const id = body?.tripId || body?.trip_id
  return typeof id === 'string' ? id.trim() : ''
}

async function loadTrip(sb, tripId) {
  const rich = await sb
    .from('trips')
    .select('id, rider_id, driver_id, status, fare_cents, tip_cents, metadata')
    .eq('id', tripId)
    .maybeSingle()
  if (!rich.error) return rich.data || null
  if (/tip_cents|column|schema cache/i.test(rich.error.message || '')) {
    const narrow = await sb
      .from('trips')
      .select('id, rider_id, driver_id, status, fare_cents, metadata')
      .eq('id', tripId)
      .maybeSingle()
    if (narrow.error) {
      const err = new Error(narrow.error.message || 'Could not load trip')
      err.status = 500
      throw err
    }
    return narrow.data ? { ...narrow.data, tip_cents: null } : null
  }
  const err = new Error(rich.error.message || 'Could not load trip')
  err.status = 500
  throw err
}

async function driverFirstName(sb, driverId) {
  if (!driverId) return null
  try {
    const { data, error } = await sb.from('profiles').select('full_name').eq('id', driverId).maybeSingle()
    if (error || !data?.full_name) return null
    const first = String(data.full_name).trim().split(/\s+/)[0]
    return first || null
  } catch {
    return null
  }
}

function offerBody(trip, priced, driverName) {
  return {
    ok: true,
    mode: 'offer',
    tripId: trip.id,
    fareCents: priced.fareCents,
    basis: priced.basis,
    driverName,
    presets: priced.presets,
    popularId: priced.popularId,
    custom: { minCents: TIP_MIN_CENTS, maxCents: TIP_MAX_CENTS },
    choice: publicChoice(readRiderTipChoice(trip.metadata)),
    chargedTipCents: chargedTipCents(trip),
    chargingWired: false,
  }
}

async function billChoice(sb, trip, userId, choice, cardClient, chargeTip) {
  if (!choice || choice.skipped || choice.tipCents <= 0) {
    return { ok: true, charged: false, chargeStatus: 'skipped', tipCents: 0 }
  }
  const run = chargeTip || chargeSavedTip
  try {
    return await run({
      sb,
      cardClient,
      trip,
      amountCents: choice.tipCents,
      riderId: userId,
    })
  } catch {
    return { ok: true, charged: false, chargeStatus: 'unavailable', tipCents: 0 }
  }
}

function recordedBody(trip, choice, { alreadyRecorded = false } = {}) {
  const charged = choice?.charged === true || choice?.chargeStatus === 'charged'
  return {
    ok: true,
    mode: 'record',
    tripId: trip.id,
    choice: publicChoice(choice),
    chargedTipCents: charged ? Math.max(0, Math.round(Number(choice.tipCents) || 0)) : 0,
    chargingWired: charged,
    alreadyRecorded,
  }
}

/**
 * Offer or record a tip choice for the signed-in rider.
 * Returns { status, body }. Card billing lives in the tip charge module.
 */
export async function applyRiderTipChoice(sb, user, rawBody, {
  now = () => new Date(),
  chargeTip = null,
  cardClient = null,
} = {}) {
  const body = { ...(rawBody || {}) }
  for (const key of CLIENT_MONEY_KEYS) delete body[key]

  const mode = body.mode == null || body.mode === '' ? 'offer' : body.mode
  if (mode !== 'offer' && mode !== 'record') {
    return { status: 400, body: { error: 'Use mode offer or record. Charging a tip is not available.' } }
  }

  const tripId = tripIdFrom(body)
  if (!tripId) return { status: 400, body: { error: 'tripId required' } }
  if (!user?.id) return { status: 401, body: { error: 'Sign in required' } }

  const trip = await loadTrip(sb, tripId)
  if (!trip || trip.rider_id !== user.id) {
    return { status: 404, body: { error: 'Trip not found' } }
  }
  if (trip.status !== 'completed') {
    return { status: 409, body: { error: 'You can tip once the trip is completed' } }
  }

  const priced = priceTipPresets(trip.fare_cents)
  const driverName = await driverFirstName(sb, trip.driver_id)
  const existing = readRiderTipChoice(trip.metadata)
  const alreadyCharged = chargedTipCents(trip)

  if (mode === 'offer') {
    return { status: 200, body: offerBody(trip, priced, driverName) }
  }

  if (alreadyCharged > 0) {
    return {
      status: 409,
      body: {
        error: 'Tip already on this trip',
        chargedTipCents: alreadyCharged,
        chargingWired: false,
      },
    }
  }

  const resolved = resolveTipChoice(trip.fare_cents, choiceIdFrom(body), body.customDollars)
  if (!resolved.ok) return { status: 400, body: { error: resolved.error, chargingWired: false } }

  if (existing && !sameRecordedChoice(existing, resolved.choice)) {
    return {
      status: 409,
      body: {
        error: 'Tip choice already saved',
        choice: publicChoice(existing),
        chargingWired: false,
      },
    }
  }

  const alreadySettled = existing && (
    existing.charged === true
    || existing.chargeStatus === 'charged'
    || resolved.choice.skipped
    || resolved.choice.tipCents <= 0
  )
  if (alreadySettled) {
    return { status: 200, body: recordedBody(trip, existing, { alreadyRecorded: true }) }
  }

  const charge = await billChoice(sb, trip, user.id, resolved.choice, cardClient, chargeTip)

  if (existing && !charge.charged && charge.chargeStatus === existing.chargeStatus) {
    return { status: 200, body: recordedBody(trip, existing, { alreadyRecorded: true }) }
  }

  const recordedAt = existing?.recordedAt || now().toISOString()
  const stored = {
    ...(existing || resolved.choice),
    ...resolved.choice,
    recordedAt,
    fareCents: existing?.fareCents ?? priced.fareCents,
    charged: Boolean(charge.charged),
    chargeStatus: charge.chargeStatus || (charge.charged ? 'charged' : 'no_card'),
    paymentIntentId: charge.paymentIntentId || existing?.paymentIntentId || null,
  }
  const metadata = {
    ...metadataObject(trip.metadata),
    rider_tip_choice: stored,
  }
  const updated = await sb.from('trips').update({ metadata }).eq('id', trip.id).eq('rider_id', user.id)
  if (updated?.error) {
    return { status: 500, body: { error: updated.error.message || 'Could not save tip choice' } }
  }

  if (charge.charged) {
    await sb.from('trips').update({ tip_cents: stored.tipCents }).eq('id', trip.id).eq('rider_id', user.id)
  }

  return { status: 200, body: recordedBody(trip, stored) }
}
