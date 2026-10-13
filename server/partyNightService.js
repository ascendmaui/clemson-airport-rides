/**
 * Party-night commands. Persistence goes through a repo so tests can use memory.
 */
import {
  applySplit,
  canJoinReturnQueue,
  MAX_PARTY_SIZE,
  PARTY_ZONE,
  partyFirstName,
  partyNightExplainer,
  presentPartyNight,
  presentReturnQueue,
  quotePartyNight,
  partyPickupReminder,
  validatePartySchedule,
} from '../shared/partyNight.js'

function partyId() {
  return crypto.randomUUID()
}

export function partyInviteToken(bytes = 16) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  let out = ''
  for (let i = 0; i < bytes; i += 1) out += alphabet[arr[i] % alphabet.length]
  return out
}

function riderName(user, displayName) {
  const raw = displayName || user?.user_metadata?.full_name || user?.email || 'Rider'
  return partyFirstName(raw)
}

function fail(status, error, code) {
  return { ok: false, status, error, ...(code ? { code } : {}) }
}

export function explainPartyNight() {
  return { ok: true, explainer: partyNightExplainer() }
}

export async function createPartyNight(repo, {
  user,
  pickup,
  dropoff,
  date,
  time,
  displayName,
  returnOptIn = false,
  now = new Date(),
  token,
}) {
  if (!user?.id) return fail(401, 'Sign in required')
  const check = validatePartySchedule({ pickup, dropoff, date, time, now })
  if (!check.ok) return fail(400, check.errors[0], 'invalid_schedule')
  const quote = quotePartyNight({ pickup: check.pickup, dropoff: check.dropoff, partySize: 1 })
  if (!quote.ok) return fail(400, quote.error)
  const hold = quote.people[0]
  const stamp = now.toISOString()
  const night = await repo.insertNight({
    id: partyId(),
    organizerId: user.id,
    token: token || partyInviteToken(),
    status: 'scheduled',
    pickup: check.pickup,
    dropoff: check.dropoff,
    pickupAt: check.pickupAt.toISOString(),
    estimatedFareCents: quote.estimatedFareCents,
    returnOptIn: Boolean(returnOptIn),
    createdAt: stamp,
    updatedAt: stamp,
  })
  const member = await repo.insertMember({
    id: partyId(),
    partyNightId: night.id,
    userId: user.id,
    displayName: riderName(user, displayName),
    shareCents: hold.shareCents,
    holdCents: hold.holdCents,
    bufferCents: hold.bufferCents,
    holdKind: 'preauth',
    joinedAt: stamp,
  })
  return { ok: true, night: presentPartyNight(night, [member], { viewerId: user.id, now }) }
}

export async function getPartyNight(repo, { token, viewerId = null, now = new Date() }) {
  if (!token) return fail(400, 'That invite link is missing a code.', 'token_required')
  const night = await repo.nightByToken(String(token))
  if (!night) return fail(404, 'That invite link is not active.', 'not_found')
  const members = await repo.membersOf(night.id)
  return { ok: true, night: presentPartyNight(night, members, { viewerId, now }) }
}

export async function joinPartyNight(repo, { user, token, displayName, now = new Date() }) {
  if (!user?.id) return fail(401, 'Sign in required')
  const night = await repo.nightByToken(String(token || ''))
  if (!night) return fail(404, 'That invite link is not active.', 'not_found')
  if (night.status === 'canceled') return fail(409, 'This party night was canceled.', 'canceled')
  const members = await repo.membersOf(night.id)
  if (members.some((member) => member.userId === user.id)) {
    return { ok: true, alreadyJoined: true, night: presentPartyNight(night, members, { viewerId: user.id, now }) }
  }
  if (members.length >= MAX_PARTY_SIZE) return fail(409, 'This party night is full.', 'full')
  const created = {
    id: partyId(),
    partyNightId: night.id,
    userId: user.id,
    displayName: riderName(user, displayName),
    joinedAt: now.toISOString(),
    shareCents: 0,
    holdCents: 0,
    bufferCents: 0,
    holdKind: 'preauth',
  }
  const shares = applySplit(night.estimatedFareCents, [...members, created])
  await repo.insertMember(shares.find((member) => member.id === created.id))
  await repo.saveMemberShares(shares)
  return { ok: true, night: presentPartyNight(night, shares, { viewerId: user.id, now }) }
}

export async function leavePartyNight(repo, { user, token, now = new Date() }) {
  if (!user?.id) return fail(401, 'Sign in required')
  const night = await repo.nightByToken(String(token || ''))
  if (!night) return fail(404, 'That invite link is not active.', 'not_found')
  const members = await repo.membersOf(night.id)
  const self = members.find((member) => member.userId === user.id)
  if (!self) return fail(404, 'You are not on this party night.', 'not_member')
  await repo.deleteMember(self.id)
  const rest = members.filter((member) => member.id !== self.id)
  if (!rest.length) {
    const canceled = await repo.updateNight(night.id, { status: 'canceled', updatedAt: now.toISOString() })
    return { ok: true, night: presentPartyNight(canceled || { ...night, status: 'canceled' }, [], { viewerId: user.id, now }) }
  }
  const shares = applySplit(night.estimatedFareCents, rest)
  await repo.saveMemberShares(shares)
  return { ok: true, night: presentPartyNight(night, shares, { viewerId: user.id, now }) }
}

export async function cancelPartyNight(repo, { user, token, now = new Date() }) {
  if (!user?.id) return fail(401, 'Sign in required')
  const night = await repo.nightByToken(String(token || ''))
  if (!night) return fail(404, 'That invite link is not active.', 'not_found')
  if (night.organizerId !== user.id) return fail(403, 'Only the person who scheduled this ride can cancel it.', 'forbidden')
  const canceled = await repo.updateNight(night.id, { status: 'canceled', updatedAt: now.toISOString() })
  const members = await repo.membersOf(night.id)
  return {
    ok: true,
    night: presentPartyNight(canceled || { ...night, status: 'canceled' }, members, { viewerId: user.id, now }),
  }
}

export async function partyReminders(repo, { user, now = new Date() }) {
  if (!user?.id) return fail(401, 'Sign in required')
  const nights = await repo.nightsForUser(user.id)
  const reminders = []
  for (const night of nights) {
    const reminder = partyPickupReminder(night, now)
    if (!reminder) continue
    reminders.push({
      nightId: night.id,
      token: night.token,
      pickupLabel: night.pickup.label,
      dropoffLabel: night.dropoff.label,
      pickupAt: night.pickupAt,
      ...reminder,
    })
  }
  reminders.sort((a, b) => Date.parse(a.pickupAt) - Date.parse(b.pickupAt))
  return { ok: true, reminders }
}

export async function joinReturnQueue(repo, {
  user,
  pickup,
  dropoff,
  partyNightId = null,
  displayName,
  now = new Date(),
}) {
  if (!user?.id) return fail(401, 'Sign in required')
  const point = pickup?.lat == null
    ? { label: PARTY_ZONE.label, lat: PARTY_ZONE.lat, lng: PARTY_ZONE.lng }
    : pickup
  const gate = canJoinReturnQueue({ pickup: point, at: now })
  if (!gate.ok) return fail(gate.code === 'return_closed' ? 409 : 400, gate.error, gate.code)
  if (!dropoff?.label) return fail(400, 'Choose where you are headed.', 'dropoff_required')
  await repo.upsertWaitingReturn({
    id: partyId(),
    riderId: user.id,
    partyNightId: partyNightId || null,
    displayName: riderName(user, displayName),
    pickup: {
      label: String(point.label || PARTY_ZONE.label).slice(0, 160),
      lat: Number(point.lat),
      lng: Number(point.lng),
    },
    dropoff: {
      label: String(dropoff.label).slice(0, 160),
      lat: Number(dropoff.lat),
      lng: Number(dropoff.lng),
    },
    joinedAt: now.toISOString(),
  })
  const waiting = await repo.waitingReturns()
  return { ok: true, queue: presentReturnQueue(waiting, { riderId: user.id, now }) }
}

export async function leaveReturnQueue(repo, { user, now = new Date() }) {
  if (!user?.id) return fail(401, 'Sign in required')
  await repo.leaveReturn(user.id)
  const waiting = await repo.waitingReturns()
  return { ok: true, queue: presentReturnQueue(waiting, { riderId: user.id, now }) }
}

export async function returnQueueView(repo, { user, now = new Date() }) {
  const waiting = await repo.waitingReturns()
  return { ok: true, queue: presentReturnQueue(waiting, { riderId: user?.id || null, now }) }
}
