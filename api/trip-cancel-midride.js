/**
 * POST /api/trip-cancel-midride
 * Rider auth. Trip must be in_progress, or arriving only after it already started.
 * Preview (confirm omitted) returns the quote. confirm:true ends the trip, stops
 * location sharing, and charges the partial fare + mid-ride cancel fee.
 *
 * This is not the wait-fee cancel used when the driver is waiting at pickup.
 */
import {
  admin, cors, json, parseBody, userFromAuth,
} from '../server/friendRideLib.js'
import { collectMidrideCharge } from '../server/collectTripCharge.js'
import {
  MIDRIDE_STATUS,
  abuseDecision,
  haversineMeters,
  isMidrideEligible,
  pathMeters,
  quoteMidrideCancel,
  readFareRates,
} from '../server/midrideFare.js'

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

async function tripHasStarted(sb, trip) {
  if (trip.status === 'in_progress') return true
  const { data, error } = await sb
    .from('trip_events')
    .select('id')
    .eq('trip_id', trip.id)
    .eq('kind', 'in_progress')
    .limit(1)
  if (error) return false
  return Boolean(data?.length)
}

async function startedAtIso(sb, trip) {
  const { data } = await sb
    .from('trip_events')
    .select('created_at')
    .eq('trip_id', trip.id)
    .eq('kind', 'in_progress')
    .order('created_at', { ascending: true })
    .limit(1)
  if (data?.[0]?.created_at) return data[0].created_at
  return trip.pickup_at || trip.accepted_at || trip.requested_at || null
}

async function progressInputs(sb, trip, startedAt) {
  const pickup = { lat: num(trip.pickup_lat), lng: num(trip.pickup_lng) }
  const dropoff = { lat: num(trip.dropoff_lat), lng: num(trip.dropoff_lng) }
  const straightM = haversineMeters(pickup, dropoff)

  const { data: shares } = await sb
    .from('location_shares')
    .select('id')
    .eq('trip_id', trip.id)
  const shareIds = (shares || []).map((s) => s.id).filter(Boolean)

  let points = []
  if (shareIds.length) {
    let q = sb
      .from('location_points')
      .select('lat, lng, recorded_at')
      .in('share_id', shareIds)
      .order('recorded_at', { ascending: true })
      .limit(800)
    if (startedAt) q = q.gte('recorded_at', startedAt)
    const { data } = await q
    points = (data || [])
      .map((p) => ({ lat: num(p.lat), lng: num(p.lng), at: p.recorded_at }))
      .filter((p) => p.lat != null && p.lng != null)
  }

  let driverPoint = null
  if (trip.driver_id) {
    const { data: driver } = await sb
      .from('driver_status')
      .select('lat, lng, updated_at')
      .eq('driver_id', trip.driver_id)
      .maybeSingle()
    const lat = num(driver?.lat)
    const lng = num(driver?.lng)
    if (lat != null && lng != null) driverPoint = { lat, lng, at: driver.updated_at }
  }

  const trail = driverPoint ? [...points, driverPoint] : points
  const alongPath = pathMeters(trail)
  const latest = trail.length ? trail[trail.length - 1] : null
  const fromPickup = latest ? haversineMeters(pickup, latest) : 0
  const distanceM = Math.max(alongPath, fromPickup)

  let basis = 'elapsed_only'
  if (alongPath > 0) basis = 'gps_path'
  else if (fromPickup > 0) basis = 'straight_line'

  const startMs = startedAt ? Date.parse(startedAt) : Date.now()
  const durationS = Math.max(0, (Date.now() - (Number.isFinite(startMs) ? startMs : Date.now())) / 1000)

  return { distanceM, straightM, durationS, basis }
}

async function depositPaidCents(sb, tripId) {
  const { data, error } = await sb
    .from('payments')
    .select('amount_cents, status, kind')
    .eq('trip_id', tripId)
    .in('kind', ['deposit', 'balance', 'midride_cancel'])
    .eq('status', 'succeeded')
  if (error || !data) return 0
  return data.reduce((sum, row) => sum + (Number(row.amount_cents) || 0), 0)
}

async function priorMidrideCount(sb, riderId, windowDays) {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()
  const { count, error } = await sb
    .from('trips')
    .select('id', { count: 'exact', head: true })
    .eq('rider_id', riderId)
    .eq('status', MIDRIDE_STATUS)
    .gte('canceled_at', since)
  if (error) return 0
  return count || 0
}

function publicQuote(quote, extra = {}) {
  return {
    status: MIDRIDE_STATUS,
    ...quote,
    ...extra,
  }
}

async function endLocationShares(sb, tripId) {
  const now = new Date().toISOString()
  await sb
    .from('location_shares')
    .update({ active: false, revoked_at: now })
    .eq('trip_id', tripId)
    .eq('active', true)
}

async function loadTrip(sb, tripId) {
  const { data, error } = await sb.from('trips').select('*').eq('id', tripId).maybeSingle()
  if (error) return { error: error.message }
  return { trip: data }
}

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })

  const tripId = body.tripId || body.trip_id
  if (!tripId) return json(res, 400, { error: 'tripId required' })
  const confirm = body.confirm === true

  const { rates, maxCancels, windowDays } = readFareRates()

  try {
    const loaded = await loadTrip(sb, tripId)
    if (loaded.error) return json(res, 500, { error: loaded.error })
    const trip = loaded.trip
    if (!trip) return json(res, 404, { error: 'Trip not found' })
    if (trip.rider_id !== user.id) return json(res, 403, { error: 'Only the rider can cancel this trip' })

    if (trip.status === MIDRIDE_STATUS) {
      const stored = trip.metadata?.midride_cancel || null
      return json(res, 200, {
        ok: true,
        alreadyCanceled: true,
        tripId: trip.id,
        status: MIDRIDE_STATUS,
        quote: stored,
      })
    }

    const started = await tripHasStarted(sb, trip)
    if (!isMidrideEligible(trip.status, { started })) {
      return json(res, 409, {
        error: 'Mid-ride cancel is only available after the trip has started.',
        code: 'not_midride',
        status: trip.status,
      })
    }

    const priorCount = await priorMidrideCount(sb, user.id, windowDays)
    const abuse = abuseDecision(priorCount, maxCancels)
    const startedAt = await startedAtIso(sb, trip)
    const progress = await progressInputs(sb, trip, startedAt)
    const paid = await depositPaidCents(sb, trip.id)
    const quote = quoteMidrideCancel({
      quotedFareCents: trip.fare_cents,
      distanceM: progress.distanceM,
      straightM: progress.straightM,
      durationS: progress.durationS,
      depositPaidCents: paid,
      rates,
    })

    const preview = publicQuote(quote, {
      tripId: trip.id,
      basis: progress.basis,
      startedAt,
      abuse: {
        ...abuse,
        windowDays,
      },
      blocked: abuse.blocked,
    })

    if (!confirm) {
      return json(res, 200, { ok: true, preview: true, quote: preview })
    }

    if (abuse.blocked) {
      return json(res, 429, {
        error: `Mid-ride cancel is paused after ${abuse.max} cancels in ${windowDays} days. Finish the trip or contact support.`,
        code: 'midride_cancel_limited',
        quote: preview,
      })
    }

    const now = new Date().toISOString()
    const metadata = {
      ...(trip.metadata && typeof trip.metadata === 'object' ? trip.metadata : {}),
      midride_cancel: {
        ...preview,
        paymentStatus: 'pending',
        canceledAt: now,
      },
    }

    const { data: locked, error: lockErr } = await sb
      .from('trips')
      .update({
        status: MIDRIDE_STATUS,
        canceled_at: now,
        metadata,
      })
      .eq('id', trip.id)
      .eq('status', trip.status)
      .select('id')
      .maybeSingle()

    if (lockErr) return json(res, 500, { error: lockErr.message })
    if (!locked) {
      const again = await loadTrip(sb, trip.id)
      if (again.trip?.status === MIDRIDE_STATUS) {
        return json(res, 200, {
          ok: true,
          alreadyCanceled: true,
          tripId: trip.id,
          status: MIDRIDE_STATUS,
          quote: again.trip.metadata?.midride_cancel || preview,
        })
      }
      return json(res, 409, { error: 'Trip status changed. Refresh and try again.', code: 'status_changed' })
    }

    await endLocationShares(sb, trip.id)

    let paymentStatus = 'uncollected'
    let stripePaymentIntentId = null
    let chargeError = null
    let clientSecret = null
    let creditsAppliedCents = 0
    let chargeSource = null

    if (quote.toCollectCents <= 0) {
      paymentStatus = 'covered_by_deposit'
    } else if (quote.toCollectCents < 50) {
      // Stripe's minimum charge is $0.50. A leftover below that is not sent to the card.
      paymentStatus = 'waived_below_minimum'
    } else {
      const { data: profile } = await sb
        .from('profiles')
        .select('stripe_customer_id, stripe_default_pm_id, full_name, email')
        .eq('id', user.id)
        .maybeSingle()
      // collectMidrideCharge never throws. A decline ends as payment_required
      // while the trip stays canceled_midride.
      const charged = await collectMidrideCharge({
        sb,
        profile,
        amountCents: quote.toCollectCents,
        riderId: user.id,
        tripId: trip.id,
        driverId: trip.driver_id,
        metadata: {
          obligation_cents: String(quote.obligationCents),
          driver_cents: String(quote.driverCents),
          platform_cents: String(quote.platformCents),
        },
      })
      paymentStatus = charged.paymentStatus
      stripePaymentIntentId = charged.stripePaymentIntentId
      chargeError = charged.chargeError
      clientSecret = charged.clientSecret
      creditsAppliedCents = charged.creditsAppliedCents
      chargeSource = charged.source
    }

    const finalQuote = {
      ...preview,
      paymentStatus,
      stripePaymentIntentId,
      chargeError,
      creditsAppliedCents,
      chargeSource,
      canceledAt: now,
      limitReached: abuse.remaining <= 1,
      paymentRequired: paymentStatus === 'payment_required',
    }

    const nextMeta = {
      ...metadata,
      midride_cancel: finalQuote,
    }
    await sb.from('trips').update({ metadata: nextMeta }).eq('id', trip.id)

    const { error: payErr } = await sb.from('payments').insert({
      trip_id: trip.id,
      rider_id: user.id,
      stripe_payment_intent_id: stripePaymentIntentId,
      kind: 'midride_cancel',
      amount_cents: quote.toCollectCents,
      status: paymentStatus,
    })
    if (payErr) console.error('[trip-cancel-midride] payments', payErr.message)

    const { error: billErr } = await sb.from('ride_bills').insert({
      trip_id: trip.id,
      participant_profile_id: user.id,
      display_name: user.user_metadata?.full_name || user.email || 'Rider',
      email: user.email || null,
      currency: 'usd',
      base_cents: quote.baseCents,
      distance_cents: quote.distanceCents,
      time_cents: quote.timeCents,
      surge_cents: 0,
      surge_multiplier: 1,
      subtotal_cents: quote.ridePortionCents,
      split_cents: quote.obligationCents,
      total_fare_cents: quote.obligationCents,
      distance_m: quote.distanceM,
      duration_s: quote.durationS,
      split_mode: 'midride_cancel',
      payment_method: paymentStatus === 'covered_by_deposit' ? 'deposit' : 'card_on_file',
      stripe_payment_intent_id: stripePaymentIntentId,
      line_items: [
        { label: 'Distance and time', cents: quote.ridePortionCents },
        { label: 'Mid-ride cancel fee', cents: quote.cancelFeeCents },
        { label: 'Deposit applied', cents: -Math.min(quote.depositPaidCents, quote.obligationCents) },
        { label: 'Charged now', cents: quote.toCollectCents },
        { label: 'Driver share (80%)', cents: quote.driverCents },
        { label: 'Platform share (20%)', cents: quote.platformCents },
      ],
      charged_at: paymentStatus === 'succeeded'
        || paymentStatus === 'covered_by_deposit'
        || paymentStatus === 'waived_below_minimum'
        ? now
        : null,
    })
    if (billErr) console.error('[trip-cancel-midride] ride_bills', billErr.message)

    await sb.from('trip_events').insert({
      trip_id: trip.id,
      kind: MIDRIDE_STATUS,
      payload: {
        reason: 'rider_midride_cancel',
        canceled_at: now,
        driver_id: trip.driver_id,
        rider_id: user.id,
        obligation_cents: quote.obligationCents,
        to_collect_cents: quote.toCollectCents,
        driver_cents: quote.driverCents,
        platform_cents: quote.platformCents,
        payment_status: paymentStatus,
        basis: progress.basis,
      },
    })

    if (paymentStatus === 'payment_required') {
      await sb.from('trip_events').insert({
        trip_id: trip.id,
        kind: 'payment_required',
        payload: {
          reason: 'midride_cancel_decline',
          rider_id: user.id,
          driver_id: trip.driver_id,
          amount_cents: quote.toCollectCents,
          charge_error: chargeError,
          trip_status: MIDRIDE_STATUS,
        },
      })
    }

    return json(res, 200, {
      ok: true,
      tripId: trip.id,
      status: MIDRIDE_STATUS,
      code: paymentStatus === 'payment_required' ? 'payment_required' : null,
      quote: { ...finalQuote, clientSecret },
    })
  } catch (err) {
    console.error('[trip-cancel-midride]', err)
    return json(res, 500, { error: err.message || 'Mid-ride cancel failed' })
  }
}
