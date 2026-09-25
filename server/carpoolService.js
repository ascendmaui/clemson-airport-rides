/**
 * Marketplace carpool queue on top of friend_rides.
 * Student-driver offers still go through /api/friend-rides?action=create.
 */
import { randomToken } from './friendRideLib.js'
import { recomputeRideFares } from './friendRideRecompute.js'
import {
  AMBASSADOR_CENTS_PER_SEAT,
  AMBASSADOR_CODE_TYPE,
  firstName,
  illustrativePeakAt,
  makeAmbassadorCode,
  matchCarpoolRequests,
  normalizeRequest,
  pitchQuote,
} from '../src/lib/carpoolEngine.js'
import { gameDayActive } from './carpoolSettle.js'
import { resolveAmbassadorCode, stampAmbassadorCode } from './ambassadorAttribution.js'
import { receivableDriverIds } from './driverApproval.js'

function missingTable(error) {
  return /relation|does not exist|schema cache/i.test(error?.message || '')
}

function ambassadorFrom(body) {
  const code = body?.ambassadorCode || body?.ambassador_code
  if (typeof code !== 'string') return null
  const trimmed = code.trim().slice(0, 40)
  return trimmed || null
}

export async function insertFriendRide(sb, row) {
  let attempt = await sb.from('friend_rides').insert(row).select('*').single()
  if (attempt.error && /fare_breakdown|column/i.test(attempt.error.message || '')) {
    const next = { ...row }
    delete next.fare_breakdown
    attempt = await sb.from('friend_rides').insert(next).select('*').single()
  }
  if (attempt.error) throw new Error(attempt.error.message)
  return attempt.data
}

async function addParticipant(sb, rideId, rider) {
  const { data, error } = await sb
    .from('friend_ride_participants')
    .insert({
      friend_ride_id: rideId,
      user_id: rider.userId || null,
      display_name: rider.displayName || 'Tiger',
      email: rider.email || null,
      pickup: rider.pickup,
      dropoff: rider.dropoff,
      status: 'joined',
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function createGroupRide(sb, {
  user,
  pickup,
  dropoff,
  displayName,
  partyType = 'carpool',
  driving = false,
  ambassadorCode = null,
}) {
  if (driving) {
    const gate = await receivableDriverIds(sb, [user?.id])
    if (gate.error) throw new Error(gate.error)
    if (!gate.allowed.has(user?.id)) {
      return {
        ok: false,
        code: 'driver_not_approved',
        error: 'Admin must approve your driver application before you can offer a carpool.',
      }
    }
  }
  ambassadorCode = await resolveAmbassadorCode(sb, user, ambassadorCode)
  const token = randomToken(18)
  const matchMode = driving ? 'student_driver' : 'marketplace'
  const ride = await insertFriendRide(sb, {
    organizer_id: user.id,
    token,
    status: 'collecting',
    split_mode: 'even',
    stops: [],
    kind: 'carpool',
    driver_profile_id: driving ? user.id : null,
    fare_breakdown: {
      match_mode: matchMode,
      party_type: partyType === 'tailgate' ? 'tailgate' : 'carpool',
      ambassador_code: ambassadorCode,
      carpool: { max_riders: partyType === 'tailgate' && driving ? 6 : 4 },
    },
  })
  await addParticipant(sb, ride.id, {
    userId: user.id,
    displayName: displayName || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Tiger',
    email: user.email || null,
    pickup,
    dropoff,
  })
  let quoted = null
  try {
    quoted = await recomputeRideFares(sb, token)
  } catch (err) {
    quoted = { ok: false, error: err.message }
  }
  return {
    token,
    rideId: ride.id,
    urlPath: `/carpool/${token}`,
    partyType: partyType === 'tailgate' ? 'tailgate' : 'carpool',
    matchMode,
    quote: quoted?.ok ? quoted.ride?.fare_breakdown?.carpool || null : null,
    recomputeError: quoted?.ok ? null : (quoted?.message || quoted?.error || null),
  }
}

function publicPool(pool, selfId) {
  return {
    id: pool.id,
    window: pool.window,
    priority: pool.priority,
    neighborhoodId: pool.neighborhoodId,
    neighborhoodLabel: pool.neighborhoodLabel,
    size: pool.size,
    openSeats: pool.openSeats,
    waiting: pool.waiting,
    score: Math.round(pool.score * 100) / 100,
    you: pool.riderIds.includes(selfId),
    riders: pool.riders.map((rider) => ({
      firstName: firstName(rider.displayName),
      neighborhood: rider.neighborhoodLabel,
    })),
    quote: pool.quote,
  }
}

export async function matchRider(sb, {
  user,
  pickup,
  dropoff,
  departAt,
  displayName,
  partyType = 'carpool',
  ambassadorCode = null,
}) {
  ambassadorCode = await resolveAmbassadorCode(sb, user, ambassadorCode)
  const now = new Date()
  const gameDay = await gameDayActive(sb, now)
  const depart = departAt ? new Date(departAt) : now
  const self = {
    id: user.id,
    userId: user.id,
    displayName: displayName || user.user_metadata?.full_name || 'Tiger',
    email: user.email || null,
    pickup,
    dropoff,
    departAt: depart,
    partyType,
  }
  const peakAt = illustrativePeakAt(depart)
  const pitch = pitchQuote({
    pickup,
    dropoff,
    at: peakAt,
    gameDay,
    displayName: self.displayName,
  })
  const nowQuote = pitchQuote({
    pickup,
    dropoff,
    at: depart,
    gameDay,
    displayName: self.displayName,
  })

  const normalized = normalizeRequest(self, { at: depart, gameDay })
  if (normalized.error) {
    return { ok: false, error: 'Pickup and dropoff need a map point.', code: normalized.error, pitch, nowQuote }
  }

  const row = {
    rider_id: user.id,
    display_name: self.displayName,
    pickup,
    dropoff,
    depart_at: depart.toISOString(),
    status: 'open',
    priority: normalized.window,
    neighborhood_id: normalized.neighborhoodId,
    dest_geohash: normalized.destGeohash,
    party_type: partyType === 'tailgate' ? 'tailgate' : 'carpool',
  }

  await sb
    .from('carpool_requests')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('rider_id', user.id)
    .eq('status', 'open')

  const inserted = await sb.from('carpool_requests').insert(row).select('*').single()
  if (inserted.error) {
    if (missingTable(inserted.error)) {
      return {
        ok: true,
        queue: false,
        code: 'queue_unavailable',
        message: 'Match queue is not migrated yet. Share a group link to split this hop now.',
        pitch,
        nowQuote,
        gameDay,
        pool: null,
      }
    }
    return { ok: false, error: inserted.error.message, pitch, nowQuote }
  }

  const windowMs = 30 * 60 * 1000
  const from = new Date(depart.getTime() - windowMs).toISOString()
  const to = new Date(depart.getTime() + windowMs).toISOString()
  const { data: openRows, error: listErr } = await sb
    .from('carpool_requests')
    .select('*')
    .eq('status', 'open')
    .gte('depart_at', from)
    .lte('depart_at', to)
    .limit(80)
  if (listErr) return { ok: false, error: listErr.message, pitch, nowQuote }

  const requests = (openRows || []).map((open) => ({
    id: open.rider_id || open.id,
    requestId: open.id,
    userId: open.rider_id,
    displayName: open.display_name,
    pickup: open.pickup,
    dropoff: open.dropoff,
    departAt: open.depart_at,
    friendRideId: open.friend_ride_id,
    email: open.rider_id === user.id ? user.email : null,
  }))
  const matched = matchCarpoolRequests(requests, { at: depart, gameDay, seats: 4 })
  const mine = matched.pools.find((pool) => pool.riderIds.includes(user.id)) || null

  let token = null
  let rideId = null
  if (mine && !mine.waiting) {
    const linked = (openRows || []).find((open) => mine.riderIds.includes(open.rider_id) && open.friend_ride_id)
    if (linked?.friend_ride_id) {
      const { data: existing } = await sb
        .from('friend_rides')
        .select('id, token, status, kind, fare_breakdown')
        .eq('id', linked.friend_ride_id)
        .maybeSingle()
      if (existing && existing.status === 'collecting') {
        rideId = existing.id
        token = existing.token
        if (ambassadorCode) {
          await stampAmbassadorCode(sb, { ...existing, kind: existing.kind || 'carpool' }, ambassadorCode)
        }
      }
    }
    const seated = new Set()
    if (!rideId) {
      const organizer = mine.riders[0]
      const created = await insertFriendRide(sb, {
        organizer_id: organizer.userId,
        token: randomToken(18),
        status: 'collecting',
        split_mode: 'even',
        stops: [],
        kind: 'carpool',
        fare_breakdown: {
          match_mode: 'marketplace',
          party_type: partyType === 'tailgate' ? 'tailgate' : 'carpool',
          ambassador_code: ambassadorCode,
          carpool: { max_riders: 4 },
        },
      })
      rideId = created.id
      token = created.token
      for (const rider of mine.riders) {
        if (seated.size >= 4) break
        const source = requests.find((req) => req.userId === rider.userId)
        await addParticipant(sb, rideId, {
          userId: rider.userId,
          displayName: rider.displayName,
          email: source?.email || null,
          pickup: rider.pickup,
          dropoff: rider.dropoff,
        })
        seated.add(rider.userId)
      }
    } else {
      const { data: parts } = await sb
        .from('friend_ride_participants')
        .select('user_id')
        .eq('friend_ride_id', rideId)
      const have = new Set((parts || []).map((p) => p.user_id))
      have.forEach((id) => seated.add(id))
      for (const rider of mine.riders) {
        if (have.has(rider.userId)) continue
        if (seated.size >= 4) break
        const source = requests.find((req) => req.userId === rider.userId)
        await addParticipant(sb, rideId, {
          userId: rider.userId,
          displayName: rider.displayName,
          email: source?.email || null,
          pickup: rider.pickup,
          dropoff: rider.dropoff,
        })
        seated.add(rider.userId)
      }
    }
    await sb
      .from('carpool_requests')
      .update({ status: 'matched', friend_ride_id: rideId, updated_at: new Date().toISOString() })
      .in('rider_id', [...seated])
      .eq('status', 'open')
    try {
      await recomputeRideFares(sb, token)
    } catch {
      /* lobby still opens; confirm retries recompute */
    }
  }

  return {
    ok: true,
    queue: true,
    gameDay,
    pitch,
    nowQuote,
    token,
    rideId,
    urlPath: token ? `/carpool/${token}` : null,
    pool: mine ? publicPool(mine, user.id) : null,
    suggestions: matched.pools
      .filter((pool) => pool.riderIds.includes(user.id) || pool.size >= 2)
      .slice(0, 4)
      .map((pool) => publicPool(pool, user.id)),
  }
}

export async function upsertAmbassador(sb, user) {
  const existing = await sb
    .from('ambassador_codes')
    .select('code, code_type, created_at')
    .eq('profile_id', user.id)
    .maybeSingle()
  if (existing.error) {
    if (missingTable(existing.error)) {
      return { ok: false, code: 'schema_missing', error: 'Ambassador tables are not migrated yet.' }
    }
    return { ok: false, error: existing.error.message }
  }
  if (existing.data) return { ok: true, ...existing.data, code_type: AMBASSADOR_CODE_TYPE }
  const code = makeAmbassadorCode(user.id)
  const inserted = await sb
    .from('ambassador_codes')
    .insert({ profile_id: user.id, code, code_type: AMBASSADOR_CODE_TYPE })
    .select('code, code_type, created_at')
    .single()
  if (inserted.error) return { ok: false, error: inserted.error.message }
  return { ok: true, ...inserted.data }
}

export async function ambassadorStats(sb, user) {
  const codeRow = await upsertAmbassador(sb, user)
  if (!codeRow.ok) return codeRow
  const ledger = await sb
    .from('ambassador_payout_ledger')
    .select('id, trip_id, seats, amount_cents, status, created_at')
    .eq('code', codeRow.code)
    .order('created_at', { ascending: false })
    .limit(50)
  if (ledger.error && missingTable(ledger.error)) {
    return { ...codeRow, rides: 0, pendingCents: 0, paidCents: 0, entries: [], centsPerSeat: AMBASSADOR_CENTS_PER_SEAT }
  }
  if (ledger.error) return { ok: false, error: ledger.error.message }
  const entries = ledger.data || []
  const pendingCents = entries.filter((row) => row.status === 'pending').reduce((sum, row) => sum + (row.amount_cents || 0), 0)
  const paidCents = entries.filter((row) => row.status === 'paid').reduce((sum, row) => sum + (row.amount_cents || 0), 0)
  return {
    ...codeRow,
    rides: entries.length,
    pendingCents,
    paidCents,
    entries,
    centsPerSeat: AMBASSADOR_CENTS_PER_SEAT,
    code_type: AMBASSADOR_CODE_TYPE,
  }
}

export { ambassadorFrom }
