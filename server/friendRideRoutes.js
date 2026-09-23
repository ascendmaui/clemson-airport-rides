/**
 * Friend-ride handlers served by /api/friend-rides.
 * Response bodies match the previous standalone routes.
 */
import {
  admin,
  cors,
  json,
  parseBody,
  userFromAuth,
  randomToken,
  loadRideByToken,
  publicRideSummary,
  stripeClient,
  stripeOk,
  ensureStripeCustomer,
  markParticipantPaid,
  markParticipantComped,
  maybeBookFriendRide,
} from './friendRideLib.js'
import {
  loadDriverVehicle,
  vehicleMaxSeats,
  DEFAULT_MAX_PARTICIPANTS,
} from './friendRideCapacity.js'
import { driverApprovalStatus } from './driverApproval.js'
import { carpoolSeatCap } from '../src/lib/carpoolEngine.js'
import { recomputeRideFares } from './friendRideRecompute.js'

export async function handleFriendRideCreate(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })

  const displayName =
    body.displayName ||
    user.user_metadata?.full_name ||
    user.email?.split('@')[0] ||
    'Organizer'
  const pickup = body.pickup || null
  const dropoff = body.dropoff || null
  const splitMode = body.splitMode === 'by_distance' ? 'by_distance' : 'even'
  const kind = body.kind === 'carpool' ? 'carpool' : 'friends'
  const partyType = body.partyType === 'tailgate' ? 'tailgate' : 'carpool'
  const ambassadorCode = typeof body.ambassadorCode === 'string' ? body.ambassadorCode.slice(0, 40) : null

  if (kind === 'carpool') {
    const gate = await driverApprovalStatus(sb, user.id)
    if (!gate.approved) {
      return json(res, 403, {
        error: 'Admin must approve your driver application before you can offer a carpool.',
        code: 'driver_not_approved',
      })
    }
  }

  const vehicle = await loadDriverVehicle(sb, user.id)
  if (!vehicle) {
    return json(res, 400, {
      error: 'Add your vehicle before offering a group ride.',
      code: 'vehicle_required',
    })
  }
  const vehicleSeats = vehicleMaxSeats(vehicle) || DEFAULT_MAX_PARTICIPANTS
  const maxParticipants = carpoolSeatCap({
    kind,
    partyType,
    matchMode: 'student_driver',
    vehicleSeats,
  })
  const vehicleLabel = `${vehicle.make || ''} ${vehicle.model || ''}`.trim() || null

  const token = randomToken(18)
  const insertRow = {
    organizer_id: user.id,
    token,
    status: 'collecting',
    split_mode: splitMode,
    stops: [],
    kind,
    fare_breakdown: {
      match_mode: kind === 'carpool' ? 'student_driver' : 'friends',
      party_type: partyType,
      ambassador_code: ambassadorCode,
      carpool: { max_riders: maxParticipants },
    },
  }
  if (kind === 'carpool') insertRow.driver_profile_id = user.id

  let { data: ride, error } = await sb
    .from('friend_rides')
    .insert(insertRow)
    .select('*')
    .single()
  if (error && /fare_breakdown|column/i.test(error.message || '')) {
    delete insertRow.fare_breakdown
    const retry = await sb.from('friend_rides').insert(insertRow).select('*').single()
    ride = retry.data
    error = retry.error
  }
  if (error) return json(res, 500, { error: error.message })

  const { data: participant, error: pErr } = await sb
    .from('friend_ride_participants')
    .insert({
      friend_ride_id: ride.id,
      user_id: user.id,
      display_name: displayName,
      email: user.email || null,
      pickup,
      dropoff,
      status: pickup || dropoff ? 'joined' : 'invited',
    })
    .select('*')
    .single()
  if (pErr) return json(res, 500, { error: pErr.message })

  const urlPath = kind === 'carpool' ? `/carpool/${ride.token}` : `/friends/${ride.token}`
  return json(res, 200, {
    ride: { ...ride, max_participants: maxParticipants, vehicle_label: vehicleLabel },
    participant,
    token: ride.token,
    kind,
    urlPath,
    maxParticipants,
    vehicleLabel,
  })
}

export async function handleFriendRideGet(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' })
  }

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  let token = ''
  if (req.method === 'GET') {
    const url = new URL(req.url || '/', 'http://localhost')
    const queryToken = req.query?.token
    token = url.searchParams.get('token')
      || (typeof queryToken === 'string' ? queryToken : '')
      || (Array.isArray(queryToken) ? queryToken[0] || '' : '')
  } else {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
    token = body.token || ''
  }
  if (!token) return json(res, 400, { error: 'token required' })

  try {
    const loaded = await loadRideByToken(sb, token)
    if (!loaded) return json(res, 404, { error: 'Friend ride not found' })
    const summary = publicRideSummary(loaded.ride, loaded.participants)

    const driverId = loaded.ride.driver_profile_id || loaded.ride.organizer_id
    const vehicle = await loadDriverVehicle(sb, driverId)
    const maxParticipants =
      Number(loaded.ride.max_participants) ||
      vehicleMaxSeats(vehicle) ||
      DEFAULT_MAX_PARTICIPANTS
    summary.max_participants = maxParticipants
    summary.vehicle_label = loaded.ride.vehicle_label || (vehicle ? `${vehicle.make || ''} ${vehicle.model || ''}`.trim() : null)

    const ids = loaded.participants.map((p) => p.user_id).filter(Boolean)
    let byId = {}
    if (ids.length) {
      const { data: profiles } = await sb
        .from('profiles')
        .select('id, stripe_default_pm_id, stripe_customer_id, student_verified_at, rating_avg, rating_count, avatar_url, full_name')
        .in('id', ids)
      byId = Object.fromEntries((profiles || []).map((p) => [p.id, p]))
      summary.participants = summary.participants.map((p) => {
        const full = loaded.participants.find((x) => x.id === p.id)
        const prof = full?.user_id ? byId[full.user_id] : null
        return {
          ...p,
          student_verified_at: prof?.student_verified_at || null,
          rating_avg: prof?.rating_avg != null ? Number(prof.rating_avg) : null,
          rating_count: prof?.rating_count != null ? Number(prof.rating_count) : 0,
          avatar_url: prof?.avatar_url || null,
        }
      })
    }

    const user = await userFromAuth(req)
    if (user) {
      if (ids.length) {
        summary.participants = summary.participants.map((p) => {
          const full = loaded.participants.find((x) => x.id === p.id)
          const prof = full?.user_id ? byId[full.user_id] : null
          return {
            ...p,
            email: user.id === loaded.ride.organizer_id || user.id === full?.user_id
              ? full?.email
              : p.email,
            has_card: Boolean(prof?.stripe_default_pm_id),
            is_self: full?.user_id === user.id,
          }
        })
      }
      summary.is_organizer = user.id === loaded.ride.organizer_id
      summary.is_driver = Boolean(
        loaded.ride.driver_profile_id && user.id === loaded.ride.driver_profile_id,
      )
      summary.viewer_id = user.id
    }

    return json(res, 200, summary)
  } catch (e) {
    return json(res, 500, { error: e.message || 'Server error' })
  }
}

export async function handleFriendRideJoin(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })

  const token = body.token
  if (!token) return json(res, 400, { error: 'token required' })

  const user = await userFromAuth(req)
  const displayName = (body.displayName || user?.user_metadata?.full_name || '').trim()
  const email = (body.email || user?.email || '').trim().toLowerCase() || null
  const pickup = body.pickup || null
  const dropoff = body.dropoff || null
  const participantId = body.participantId || null

  if (!displayName) return json(res, 400, { error: 'displayName required' })
  if (!pickup && !dropoff) return json(res, 400, { error: 'pickup and/or dropoff required' })

  try {
    const loaded = await loadRideByToken(sb, token)
    if (!loaded) return json(res, 404, { error: 'Friend ride not found' })
    const { ride, participants } = loaded

    if (['booked', 'canceled'].includes(ride.status)) {
      return json(res, 409, { error: `Ride is ${ride.status}` })
    }
    if (['awaiting_payment', 'ready'].includes(ride.status) && !participantId) {
      return json(res, 409, { error: 'Stops are locked while payment is in progress' })
    }

    const driverId = ride.driver_profile_id || ride.organizer_id
    const vehicle = await loadDriverVehicle(sb, driverId)
    const vehicleSeats =
      Number(ride.max_participants) ||
      vehicleMaxSeats(vehicle) ||
      DEFAULT_MAX_PARTICIPANTS
    const maxParticipants = carpoolSeatCap({
      kind: ride.kind,
      partyType: ride.fare_breakdown?.party_type,
      matchMode: ride.fare_breakdown?.match_mode,
      vehicleSeats,
    })

    let existing = null
    if (participantId) {
      existing = participants.find((p) => p.id === participantId)
    } else if (user?.id) {
      existing = participants.find((p) => p.user_id === user.id)
    } else if (email) {
      existing = participants.find((p) => (p.email || '').toLowerCase() === email)
    }

    if (existing) {
      if (existing.status === 'paid') {
        return json(res, 409, { error: 'Already paid — stops frozen' })
      }
      const { data: updated, error } = await sb
        .from('friend_ride_participants')
        .update({
          display_name: displayName,
          email: email || existing.email,
          user_id: user?.id || existing.user_id,
          pickup,
          dropoff,
          status: 'joined',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select('*')
        .single()
      if (error) return json(res, 500, { error: error.message })
      const reloaded = await loadRideByToken(sb, token)
      return json(res, 200, {
        participant: updated,
        ride: {
          ...publicRideSummary(reloaded.ride, reloaded.participants),
          max_participants: maxParticipants,
        },
      })
    }

    if (participants.length >= maxParticipants) {
      return json(res, 409, {
        error: `This ride is full (${maxParticipants} max for this vehicle).`,
        code: 'capacity_full',
        maxParticipants,
      })
    }

    const { data: inserted, error } = await sb
      .from('friend_ride_participants')
      .insert({
        friend_ride_id: ride.id,
        user_id: user?.id || null,
        display_name: displayName,
        email,
        pickup,
        dropoff,
        status: 'joined',
      })
      .select('*')
      .single()
    if (error) return json(res, 500, { error: error.message })

    if (ride.status === 'draft') {
      await sb.from('friend_rides').update({ status: 'collecting' }).eq('id', ride.id)
    }

    const reloaded = await loadRideByToken(sb, token)
    return json(res, 200, {
      participant: inserted,
      ride: {
        ...publicRideSummary(reloaded.ride, reloaded.participants),
        max_participants: maxParticipants,
      },
    })
  } catch (e) {
    return json(res, 500, { error: e.message || 'Server error' })
  }
}

export async function handleFriendRideRecompute(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })
  const token = body.token
  if (!token) return json(res, 400, { error: 'token required' })

  try {
    let splitMode = undefined
    if (body.splitMode === 'even' || body.splitMode === 'by_distance') {
      const user = await userFromAuth(req)
      const loaded = await loadRideByToken(sb, token)
      if (loaded && user && user.id === loaded.ride.organizer_id) {
        splitMode = body.splitMode
      }
    }

    const result = await recomputeRideFares(sb, token, { splitMode })
    if (!result.ok) {
      const status = result.code === 'not_found' ? 404 : result.code === 'waypoints' ? 400 : 503
      return json(res, status, {
        error: result.error,
        code: result.code,
        message: result.message || result.error,
      })
    }

    return json(res, 200, {
      ...publicRideSummary(result.ride, result.participants),
      max_participants: result.maxParticipants,
      vehicle_label: result.vehicleLabel,
      route: result.route,
      fareHeuristic: result.fareHeuristic,
    })
  } catch (e) {
    console.error('[friend-rides-recompute]', e)
    return json(res, 500, { error: e.message || 'Server error' })
  }
}

export async function handleFriendRideConfirmCharges(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  if (!stripeOk()) {
    return json(res, 503, {
      error: 'Payments unavailable',
      message: 'STRIPE_SECRET_KEY is not configured. Cannot charge friend rides.',
    })
  }

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })
  const token = body.token
  if (!token) return json(res, 400, { error: 'token required' })

  const stripe = stripeClient()
  const origin =
    body.origin ||
    process.env.VITE_APP_URL ||
    'https://clemson-airport-rides.vercel.app'

  try {
    const loaded = await loadRideByToken(sb, token)
    if (!loaded) return json(res, 404, { error: 'Friend ride not found' })
    let { ride, participants } = loaded
    if (ride.organizer_id !== user.id) return json(res, 403, { error: 'Organizer only' })
    if (ride.trip_id) return json(res, 409, { error: 'Already booked', trip_id: ride.trip_id })

    const recomputed = await recomputeRideFares(sb, token, { splitMode: ride.split_mode })
    if (!recomputed.ok) {
      return json(res, 400, {
        error: recomputed.message || recomputed.error || 'Could not calculate fares',
        code: recomputed.code || 'recompute_failed',
        message: recomputed.message || recomputed.error,
      })
    }
    ride = recomputed.ride
    participants = recomputed.participants
    if (!ride.total_fare_cents || !participants.every((p) => p.fare_cents != null)) {
      return json(res, 400, {
        error: 'Could not calculate fares for this ride. Check pickups/dropoffs and try again.',
        code: 'fares_missing',
      })
    }

    await sb
      .from('friend_rides')
      .update({ status: 'awaiting_payment', updated_at: new Date().toISOString() })
      .eq('id', ride.id)

    const results = []
    const paymentElementSecrets = []

    for (const p of participants) {
      if (p.status === 'paid') {
        results.push({ participantId: p.id, status: 'already_paid' })
        continue
      }
      const comp = (ride.fare_breakdown?.carpool?.shares || []).find(
        (share) => share.id === p.id && share.firstRideFree,
      )
      if (comp) {
        await markParticipantComped(sb, p, 'first_ride_free')
        results.push({ participantId: p.id, status: 'comped', reason: 'first_ride_free' })
        continue
      }
      if (!p.fare_cents || p.fare_cents <= 0) {
        results.push({ participantId: p.id, status: 'skipped', error: 'No fare' })
        continue
      }

      let profile = null
      if (p.user_id) {
        const { data } = await sb
          .from('profiles')
          .select('id, email, full_name, stripe_customer_id, stripe_default_pm_id')
          .eq('id', p.user_id)
          .maybeSingle()
        profile = data
      }

      if (profile?.stripe_default_pm_id && profile?.stripe_customer_id) {
        try {
          await sb
            .from('friend_ride_participants')
            .update({
              charge_attempts: (p.charge_attempts || 0) + 1,
              charge_error: null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', p.id)

          const pi = await stripe.paymentIntents.create({
            amount: p.fare_cents,
            currency: 'usd',
            customer: profile.stripe_customer_id,
            payment_method: profile.stripe_default_pm_id,
            off_session: true,
            confirm: true,
            metadata: {
              kind: 'friend_ride_share',
              friend_ride_id: ride.id,
              participant_id: p.id,
              token: ride.token,
              carpool: ride.kind === 'carpool' ? '1' : '0',
              share_cents: String(p.fare_cents),
            },
          })

          if (pi.status === 'succeeded') {
            await markParticipantPaid(sb, p, pi)
            results.push({ participantId: p.id, status: 'paid', paymentIntentId: pi.id })
          } else if (pi.status === 'requires_action') {
            paymentElementSecrets.push({
              participantId: p.id,
              clientSecret: pi.client_secret,
              reason: 'requires_action',
            })
            await sb
              .from('friend_ride_participants')
              .update({
                stripe_payment_intent_id: pi.id,
                charge_error: 'requires_authentication',
                updated_at: new Date().toISOString(),
              })
              .eq('id', p.id)
            results.push({ participantId: p.id, status: 'requires_action', paymentIntentId: pi.id })
          } else {
            await sb
              .from('friend_ride_participants')
              .update({
                stripe_payment_intent_id: pi.id,
                charge_error: `status:${pi.status}`,
                updated_at: new Date().toISOString(),
              })
              .eq('id', p.id)
            results.push({ participantId: p.id, status: 'failed', error: pi.status })
          }
        } catch (err) {
          const msg = err?.message || 'Charge failed'
          await sb
            .from('friend_ride_participants')
            .update({
              charge_error: msg,
              charge_attempts: (p.charge_attempts || 0) + 1,
              updated_at: new Date().toISOString(),
            })
            .eq('id', p.id)
          results.push({ participantId: p.id, status: 'failed', error: msg })
        }
        continue
      }

      try {
        let customerId = null
        if (profile) {
          customerId = await ensureStripeCustomer(stripe, sb, profile)
        } else if (p.email) {
          const customer = await stripe.customers.create({
            email: p.email,
            name: p.display_name,
            metadata: { participant_id: p.id, friend_ride_id: ride.id },
          })
          customerId = customer.id
        }

        const piParams = {
          amount: p.fare_cents,
          currency: 'usd',
          automatic_payment_methods: { enabled: true },
          metadata: {
            kind: 'friend_ride_share',
            friend_ride_id: ride.id,
            participant_id: p.id,
            token: ride.token,
            carpool: ride.kind === 'carpool' ? '1' : '0',
            share_cents: String(p.fare_cents),
          },
        }
        if (customerId) piParams.customer = customerId

        const pi = await stripe.paymentIntents.create(piParams)
        await sb
          .from('friend_ride_participants')
          .update({
            stripe_payment_intent_id: pi.id,
            charge_error: 'needs_card',
            charge_attempts: (p.charge_attempts || 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', p.id)

        paymentElementSecrets.push({
          participantId: p.id,
          clientSecret: pi.client_secret,
          displayName: p.display_name,
          fareCents: p.fare_cents,
          reason: 'needs_card',
        })
        results.push({ participantId: p.id, status: 'needs_card', paymentIntentId: pi.id })
      } catch (err) {
        await sb
          .from('friend_ride_participants')
          .update({ charge_error: err.message, updated_at: new Date().toISOString() })
          .eq('id', p.id)
        results.push({ participantId: p.id, status: 'failed', error: err.message })
      }
    }

    const book = await maybeBookFriendRide(sb, ride.id)
    const reloaded = await loadRideByToken(sb, token)

    return json(res, 200, {
      results,
      paymentElementSecrets,
      booked: book.booked,
      trip: book.trip || null,
      bookReason: book.reason || null,
      ride: publicRideSummary(reloaded.ride, reloaded.participants),
      returnUrl: `${origin}/${(reloaded.ride.kind === 'carpool' ? 'carpool' : 'friends')}/${token}?charged=1`,
      note: 'Apple Pay requires the domain to be registered in Stripe Dashboard -> Payment method domains.',
    })
  } catch (e) {
    console.error('[confirm-charges]', e)
    return json(res, 500, { error: e.message || 'Server error' })
  }
}

export async function handleFriendRideRetryCharge(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  if (!stripeOk()) {
    return json(res, 503, { error: 'Payments unavailable', message: 'STRIPE_SECRET_KEY not configured' })
  }

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  const user = await userFromAuth(req)
  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })

  const { token, participantId } = body
  if (!token || !participantId) return json(res, 400, { error: 'token and participantId required' })

  const stripe = stripeClient()

  try {
    const loaded = await loadRideByToken(sb, token)
    if (!loaded) return json(res, 404, { error: 'Friend ride not found' })
    const { ride, participants } = loaded
    const p = participants.find((x) => x.id === participantId)
    if (!p) return json(res, 404, { error: 'Participant not found' })
    if (p.status === 'paid') return json(res, 200, { status: 'already_paid' })

    const isOrg = user && user.id === ride.organizer_id
    const isSelf = user && p.user_id && user.id === p.user_id
    if (!isOrg && !isSelf) return json(res, 403, { error: 'Not allowed' })

    let profile = null
    if (p.user_id) {
      const { data } = await sb
        .from('profiles')
        .select('id, email, full_name, stripe_customer_id, stripe_default_pm_id')
        .eq('id', p.user_id)
        .maybeSingle()
      profile = data
    }

    if (profile?.stripe_default_pm_id) {
      const customerId = await ensureStripeCustomer(stripe, sb, profile)
      try {
        const pi = await stripe.paymentIntents.create({
          amount: p.fare_cents,
          currency: 'usd',
          customer: customerId,
          payment_method: profile.stripe_default_pm_id,
          off_session: true,
          confirm: true,
          metadata: {
            kind: 'friend_ride_share',
            friend_ride_id: ride.id,
            participant_id: p.id,
            token: ride.token,
          },
        })
        if (pi.status === 'succeeded') {
          const book = await markParticipantPaid(sb, p, pi)
          const reloaded = await loadRideByToken(sb, token)
          return json(res, 200, {
            status: 'paid',
            booked: book.booked,
            trip: book.trip || null,
            ride: publicRideSummary(reloaded.ride, reloaded.participants),
          })
        }
        return json(res, 200, {
          status: pi.status,
          clientSecret: pi.client_secret,
          paymentIntentId: pi.id,
        })
      } catch (err) {
        await sb
          .from('friend_ride_participants')
          .update({
            charge_error: err.message,
            charge_attempts: (p.charge_attempts || 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', p.id)
        return json(res, 402, { status: 'failed', error: err.message })
      }
    }

    const piParams = {
      amount: p.fare_cents,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: {
        kind: 'friend_ride_share',
        friend_ride_id: ride.id,
        participant_id: p.id,
        token: ride.token,
      },
    }
    if (profile) {
      piParams.customer = await ensureStripeCustomer(stripe, sb, profile)
    }
    const pi = await stripe.paymentIntents.create(piParams)
    await sb
      .from('friend_ride_participants')
      .update({
        stripe_payment_intent_id: pi.id,
        charge_error: 'needs_card',
        charge_attempts: (p.charge_attempts || 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', p.id)

    return json(res, 200, {
      status: 'needs_card',
      clientSecret: pi.client_secret,
      paymentIntentId: pi.id,
      fareCents: p.fare_cents,
    })
  } catch (e) {
    return json(res, 500, { error: e.message || 'Server error' })
  }
}
