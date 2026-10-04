/**
 * Rider tip choice after a completed trip.
 * Amounts come from the stored fare. Client fare, deposit, amount, total,
 * isStudent, and tip cents are ignored. This module records the choice only.
 * It does not create a Stripe charge.
 */

export const TIP_MIN_CENTS = 100
export const TIP_MAX_CENTS = 10000
export const TIP_STEP_CENTS = 25

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
]

function finiteFare(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.round(n))
}

function roundToStep(cents) {
  return Math.round(cents / TIP_STEP_CENTS) * TIP_STEP_CENTS
}

function clampTip(cents) {
  return Math.min(TIP_MAX_CENTS, Math.max(TIP_MIN_CENTS, roundToStep(cents)))
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
  const amounts = PERCENTS.map((percent) => clampTip(Math.round((basisFare * percent) / 100)))
  if (!strictlyIncreasing(amounts)) {
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

export function resolveTipChoice(fareCents, choiceId) {
  if (choiceId === 'skip') {
    return {
      ok: true,
      priced: priceTipPresets(fareCents),
      choice: {
        id: 'skip',
        tipCents: 0,
        percent: null,
        skipped: true,
        charged: false,
        chargeStatus: 'not_wired',
      },
    }
  }
  const priced = priceTipPresets(fareCents)
  const preset = priced.presets.find((row) => row.id === choiceId)
  if (!preset) {
    return { ok: false, error: 'Choose a tip from the list or skip' }
  }
  return {
    ok: true,
    priced,
    choice: {
      id: preset.id,
      tipCents: preset.cents,
      percent: preset.percent,
      skipped: false,
      charged: false,
      chargeStatus: 'not_wired',
    },
  }
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
  return {
    id: choice.id || null,
    tipCents: Math.max(0, Math.round(Number(choice.tipCents) || 0)),
    percent: choice.percent == null ? null : Number(choice.percent),
    skipped: Boolean(choice.skipped),
    charged: false,
    chargeStatus: 'not_wired',
    recordedAt: choice.recordedAt || null,
  }
}

function chargedTipCents(trip) {
  const n = Number(trip?.tip_cents)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(n)
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
    choice: publicChoice(readRiderTipChoice(trip.metadata)),
    chargedTipCents: chargedTipCents(trip),
    chargingWired: false,
  }
}

/**
 * Offer or record a tip choice for the signed-in rider.
 * Returns { status, body }. Never calls Stripe.
 */
export async function applyRiderTipChoice(sb, user, rawBody, { now = () => new Date() } = {}) {
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

  const resolved = resolveTipChoice(trip.fare_cents, choiceIdFrom(body))
  if (!resolved.ok) return { status: 400, body: { error: resolved.error, chargingWired: false } }

  if (existing) {
    if (existing.id === resolved.choice.id) {
      return {
        status: 200,
        body: {
          ok: true,
          mode: 'record',
          tripId: trip.id,
          choice: publicChoice(existing),
          chargedTipCents: 0,
          chargingWired: false,
          alreadyRecorded: true,
        },
      }
    }
    return {
      status: 409,
      body: {
        error: 'Tip choice already saved',
        choice: publicChoice(existing),
        chargingWired: false,
      },
    }
  }

  const recordedAt = now().toISOString()
  const stored = {
    ...resolved.choice,
    recordedAt,
    fareCents: priced.fareCents,
  }
  const metadata = {
    ...metadataObject(trip.metadata),
    rider_tip_choice: stored,
  }
  const updated = await sb.from('trips').update({ metadata }).eq('id', trip.id).eq('rider_id', user.id)
  if (updated?.error) {
    return { status: 500, body: { error: updated.error.message || 'Could not save tip choice' } }
  }

  return {
    status: 200,
    body: {
      ok: true,
      mode: 'record',
      tripId: trip.id,
      choice: publicChoice(stored),
      chargedTipCents: 0,
      chargingWired: false,
    },
  }
}
