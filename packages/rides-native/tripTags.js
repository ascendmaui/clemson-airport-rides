/**
 * Driver-facing labels for trips the web app already stores.
 * No network, no Stripe, no self-driving calls.
 */

export const TESLA_FLEET_NOTICE =
  'Coming soon. Tesla Model 3 is a profile option only. A person still drives the car. There is no self-driving dispatch.'

export const ACTIONABLE_LEAD_MS = 45 * 60 * 1000

const QUEUE_FILTERS = ['all', 'student', 'game_day', 'weekend_party']

export function formatCents(cents) {
  const n = Math.round(Number(cents) || 0)
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  return `${sign}$${(abs / 100).toFixed(2)}`
}

/** Driver keeps 80%. Platform fee is 20% of the fare, rounded once. */
export function driverNetCents(fareCents) {
  const fare = Math.max(0, Math.round(Number(fareCents) || 0))
  const fee = Math.round(fare * 0.2)
  return fare - fee
}

/** 25% airport deposit. A stored deposit_cents wins over the formula. */
export function depositSliceCents(fareCents, stored) {
  if (stored != null && stored !== '' && Number.isFinite(Number(stored))) {
    return Math.max(0, Math.round(Number(stored)))
  }
  const fare = Math.max(0, Math.round(Number(fareCents) || 0))
  if (!fare) return 0
  return Math.round(fare * 0.25)
}

function metaOf(row) {
  return row?.metadata && typeof row.metadata === 'object' ? row.metadata : {}
}

function purposeId(row) {
  const meta = metaOf(row)
  return String(meta.purpose || meta.partyType || meta.party_type || row?.rider_note || '').toLowerCase()
}

export function zonedWeekdayHour(iso, timeZone = 'America/New_York') {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  })
  const bag = {}
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== 'literal') bag[part.type] = part.value
  }
  let hour = Number(bag.hour)
  if (hour === 24) hour = 0
  return { weekday: bag.weekday, hour }
}

/** Friday 5pm through Sunday, America/New_York. */
export function isWeekendPartyWindow(iso) {
  const parts = zonedWeekdayHour(iso)
  if (!parts) return false
  if (parts.weekday === 'Fri') return parts.hour >= 17
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return true
  return false
}

export function formatPickupAt(iso) {
  if (!iso) return 'Time TBD'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Time TBD'
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export function isSameZonedDay(iso, now = new Date(), timeZone = 'America/New_York') {
  if (!iso) return false
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return false
  const fmt = (value) => new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value)
  return fmt(date) === fmt(now)
}

/**
 * Future scheduled rides stay off the live trip sheet until 45 minutes out.
 * Immediate trips (no pickup time) stay actionable.
 */
export function isDueNow(trip, now = new Date()) {
  if (!trip) return false
  const when = trip.pickupAt || trip.pickup_at || trip.scheduled_for
  if (!when) return true
  const at = new Date(when).getTime()
  if (!Number.isFinite(at)) return true
  return at - now.getTime() <= ACTIONABLE_LEAD_MS
}

export const TAG_LABELS = {
  student: 'Student discount',
  game_day: 'Game day',
  weekend_party: 'Weekend / party',
  tesla: 'Tesla Model 3 · stub',
  direct: 'Chosen you',
  scheduled: 'Scheduled',
}

export function tagLabel(id) {
  return TAG_LABELS[id] || String(id)
}

export function tripTags(row, { gameDayLive = false } = {}) {
  const meta = metaOf(row)
  const purpose = purposeId(row)
  const tags = []
  const studentCents = Number(meta.student_discount_cents || meta.discountCents || 0)
  if (studentCents > 0 || meta.isStudent === true || meta.student === true || meta.studentLabel) {
    tags.push('student')
  }
  const window = String(meta.window || meta.demand_window || meta.demandWindow || '')
  const purposeText = `${purpose} ${meta.title || ''}`
  if (meta.game_day === true || window === 'game_day' || /game[\s-]?day|gameday|tailgate/.test(purposeText)) {
    tags.push('game_day')
  } else if (gameDayLive && /stadium|death valley/i.test(`${row?.pickup_label || ''} ${row?.dropoff_label || ''}`)) {
    tags.push('game_day')
  }
  const when = row?.pickup_at || row?.scheduled_for
  const scheduled = row?.status === 'scheduled' || meta.kind === 'scheduled' || Boolean(meta.purpose)
  if (
    /party|tailgate|weekend/.test(purpose)
    || meta.partyType === 'tailgate'
    || meta.party_type === 'tailgate'
    || (scheduled && when && isWeekendPartyWindow(when))
  ) {
    tags.push('weekend_party')
  }
  const tier = String(row?.tier || meta.tier || '')
  if (tier === 'tesla' || tier === 'tesla_self_driving' || meta.tesla === true || meta.is_tesla === true) {
    tags.push('tesla')
  }
  if (row?.status === 'requested' && row?.driver_id) tags.push('direct')
  if (row?.status === 'scheduled' || meta.kind === 'scheduled') tags.push('scheduled')
  return tags
}

const ACTIVE = new Set(['accepted', 'arriving', 'arrived', 'in_progress'])

export function isActiveStatus(status) {
  return ACTIVE.has(String(status || ''))
}

export function nextTripStatus(status) {
  switch (status) {
    case 'accepted':
      return 'arriving'
    case 'arriving':
      return 'arrived'
    case 'arrived':
      return 'in_progress'
    case 'in_progress':
      return 'completed'
    default:
      return null
  }
}

export function statusActionLabel(status) {
  switch (status) {
    case 'accepted':
      return 'Arriving'
    case 'arriving':
      return "I'm here"
    case 'arrived':
      return 'Start trip'
    case 'in_progress':
      return 'Complete trip'
    default:
      return null
  }
}

export function statusHeadline(status) {
  switch (status) {
    case 'requested':
      return 'Rider chose you'
    case 'searching':
    case 'offered':
      return 'New ride request'
    case 'scheduled':
      return 'Scheduled ride'
    case 'accepted':
      return 'Head to pickup'
    case 'arriving':
      return 'Arriving at pickup'
    case 'arrived':
      return 'Waiting for the rider'
    case 'in_progress':
      return 'Trip in progress'
    case 'completed':
      return 'Completed'
    case 'canceled':
    case 'cancelled_wait':
      return 'Canceled'
    default:
      return status ? String(status) : 'Ride'
  }
}

export function toDriverCard(row, options) {
  if (!row?.id) return null
  const meta = metaOf(row)
  const tags = tripTags(row, options)
  const fareCents = Math.round(Number(row.fare_cents) || 0)
  const storedDeposit = row.deposit_cents != null ? row.deposit_cents : meta.depositCents
  const first = String(meta.rider_first_name || 'Rider').trim().split(/\s+/)[0] || 'Rider'
  return {
    id: row.id,
    status: row.status,
    driverId: row.driver_id || null,
    riderId: row.rider_id || null,
    pickupLabel: row.pickup_label || 'Pickup',
    dropoffLabel: row.dropoff_label || 'Drop-off',
    pickupAt: row.pickup_at || row.scheduled_for || null,
    pickupLat: row.pickup_lat != null ? Number(row.pickup_lat) : null,
    pickupLng: row.pickup_lng != null ? Number(row.pickup_lng) : null,
    dropoffLat: row.dropoff_lat != null ? Number(row.dropoff_lat) : null,
    dropoffLng: row.dropoff_lng != null ? Number(row.dropoff_lng) : null,
    fareCents,
    depositCents: depositSliceCents(fareCents, storedDeposit),
    driverNetCents: driverNetCents(fareCents),
    firstName: first,
    purpose: meta.purpose || row.rider_note || '',
    tier: row.tier || null,
    tags,
    tagLabels: tags.map(tagLabel),
    teslaStub: tags.includes('tesla'),
    arrivedAt: row.arrived_at || null,
  }
}

export function matchesQueueFilter(card, filter) {
  if (!card) return false
  switch (filter) {
    case 'all':
      return true
    case 'student':
      return card.tags.includes('student')
    case 'game_day':
      return card.tags.includes('game_day')
    case 'weekend_party':
      return card.tags.includes('weekend_party')
    default: {
      const unknown = filter
      throw new Error(`Unknown queue filter: ${unknown}`)
    }
  }
}

export function queueFilters() {
  return QUEUE_FILTERS.slice()
}

function succeeded(status) {
  return /succeeded|paid|complete/i.test(String(status || ''))
}

export function depositStatusLine(payments) {
  const rows = (payments || []).filter((row) => {
    const kind = String(row.kind || '')
    return kind === 'deposit' || kind === 'airport_deposit'
  })
  if (!rows.length) return null
  const cents = rows.reduce((sum, row) => sum + (Number(row.amountCents ?? row.amount_cents) || 0), 0)
  const open = rows.find((row) => !succeeded(row.status))
  if (!open) return `Deposit ${formatCents(cents)} paid`
  return `Deposit ${formatCents(cents)} · ${open.status || 'pending'}`
}

export function summarizeDepositAwareness(trips, paymentsByTrip, now = new Date()) {
  let depositPaidCents = 0
  let depositOpenCents = 0
  let driverNetCentsTotal = 0
  let todayNetCents = 0
  const lines = []
  for (const trip of trips || []) {
    const payments = paymentsByTrip?.[trip.id] || []
    const deposits = payments.filter((row) => row.kind === 'deposit' || row.kind === 'airport_deposit')
    for (const row of deposits) {
      const cents = Number(row.amountCents ?? row.amount_cents) || 0
      if (succeeded(row.status)) depositPaidCents += cents
      else depositOpenCents += cents
    }
    if (trip.status === 'completed') {
      const net = driverNetCents(trip.fare_cents)
      driverNetCentsTotal += net
      if (isSameZonedDay(trip.completed_at, now)) todayNetCents += net
    }
    const line = depositStatusLine(payments)
    if (line) {
      lines.push({
        tripId: trip.id,
        dropoff: trip.dropoff_label || 'Trip',
        line,
        fareCents: Number(trip.fare_cents) || 0,
      })
    }
  }
  return { depositPaidCents, depositOpenCents, driverNetCents: driverNetCentsTotal, todayNetCents, lines }
}
