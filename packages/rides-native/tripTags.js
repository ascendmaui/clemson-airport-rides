/**
 * Driver-facing labels for trips the web app already stores.
 * No network, no Stripe, no self-driving calls.
 */

export const TESLA_FLEET_NOTICE =
  'Coming soon. Tesla Model 3 is a profile option only. A person still drives the car. There is no self-driving dispatch.'

/** Notice for a selected Tesla Model 3 option. Null when Tesla is not the choice. */
export function teslaFleetNotice(selected) {
  return selected ? TESLA_FLEET_NOTICE : null
}

export const ACTIONABLE_LEAD_MS = 45 * 60 * 1000

/** Same sentence the database raises when an accept of an unpaid airport deposit is rejected. */
export const UNPAID_AIRPORT_DEPOSIT_ACCEPT_ERROR =
  'Airport deposit still unpaid. This ride is not claimable until the rider pays the deposit.'

const QUEUE_FILTERS = ['all', 'student', 'game_day', 'weekend_party']

export function formatCents(cents) {
  const n = Math.round(Number(cents) || 0)
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  return `${sign}$${(abs / 100).toFixed(2)}`
}

/** Named carpool incentive. Recent earnings use metadata.driver_payout_cents. */
export const DRIVER_CARPOOL_BONUS_ID = 'driver_carpool_bonus'

/** Driver keeps 80%. Platform fee is 20% of the fare, rounded once. */
export function driverNetCents(fareCents) {
  const fare = Math.max(0, Math.round(Number(fareCents) || 0))
  const fee = Math.round(fare * 0.2)
  return fare - fee
}

function finiteCents(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.round(n))
}

/**
 * Carpool take stored on the trip. Null when the row has no driver payout.
 * baseNetCents + bonusCents equals payoutCents when the quote recorded a solo net.
 */
export function carpoolPayFromTrip(row) {
  const meta = metaOf(row)
  const quote = meta.carpool && typeof meta.carpool === 'object' ? meta.carpool : null
  const driver = quote?.driver && typeof quote.driver === 'object' ? quote.driver : {}
  const payoutCents = finiteCents(meta.driver_payout_cents ?? driver.payoutCents ?? row?.driverPayoutCents)
  if (payoutCents == null) return null
  const rawId = String(meta.incentive_id || driver.incentiveId || row?.carpoolIncentiveId || '')
  const solo = finiteCents(driver.soloPayoutCents ?? row?.baseNetCents)
  const storedBonus = finiteCents(driver.carpoolBonusCents ?? row?.carpoolBonusCents)
  const isCarpool = rawId === DRIVER_CARPOOL_BONUS_ID
    || storedBonus != null
    || meta.kind === 'carpool'
    || quote != null
    || Boolean(meta.fare_breakdown?.carpool)
  const bonusCents = isCarpool
    ? (storedBonus != null ? storedBonus : (solo != null ? Math.max(0, payoutCents - solo) : 0))
    : 0
  const baseNetCents = solo != null ? solo : Math.max(0, payoutCents - bonusCents)
  const showBonus = isCarpool
  return {
    baseNetCents,
    bonusCents,
    payoutCents,
    incentiveId: showBonus ? (rawId || DRIVER_CARPOOL_BONUS_ID) : '',
    showBonus,
  }
}

/** Recent earnings: carpool uses metadata.driver_payout_cents, otherwise 80% of the fare. */
export function tripEarnedCents(trip) {
  const pay = carpoolPayFromTrip(trip)
  if (pay) return pay.payoutCents
  return driverNetCents(trip?.fare_cents ?? trip?.fareCents)
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


/** Required cash deposit cents for an airport hold (0 means no card deposit). */
export function airportDepositRequiredCents(row) {
  if (!row || typeof row !== 'object') return 0
  const meta = metaOf(row)
  const stored = row.deposit_cents != null && row.deposit_cents !== ''
    ? row.deposit_cents
    : meta.depositCents
  return Math.max(0, Math.round(Number(stored) || 0))
}

/** Airport trip markers used by checkout + driver desk. */
export function isAirportDepositTrip(row) {
  if (!row || typeof row !== 'object') return false
  if (airportDepositRequiredCents(row) <= 0) return false
  const meta = metaOf(row)
  if (meta.purpose === 'airport' || meta.kind === 'airport') return true
  if (meta.airport) return true
  const note = String(row.rider_note || '').trim().toLowerCase()
  return note === 'airport'
}

/**
 * Paid markers that survive without a payments join:
 * - checkout_deposit stamped by webhook restore / happy-path deposit
 * - fare_paid_cents bumped when the deposit Checkout succeeds
 */
export function isAirportDepositPaid(row) {
  if (!row || typeof row !== 'object') return false
  const meta = metaOf(row)
  if (meta.checkout_deposit && typeof meta.checkout_deposit === 'object') return true
  const required = airportDepositRequiredCents(row)
  if (required <= 0) return true
  const paid = Math.max(0, Math.round(Number(meta.fare_paid_cents) || 0))
  return paid >= required
}

/** Searching/scheduled airport holds still waiting on the 25% card deposit. */
export function isUnpaidAirportDepositTrip(row) {
  return isAirportDepositTrip(row) && !isAirportDepositPaid(row)
}

/** Open-pool / accept eligibility for driver match. */
export function isOpenPoolClaimable(row) {
  return !isUnpaidAirportDepositTrip(row)
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
  carpool: 'Carpool · split fare',
  tesla: 'Tesla Model 3 · stub',
  direct: 'Preferred by rider',
  scheduled: 'Scheduled',
}

/** Rider Apple Pay is authorized on the rider's phone. Settle charges it off-session. */
export const APPLE_PAY_DRIVER_COPY =
  'The 25% deposit and the rest of the fare are collected by Stripe from the rider’s saved card or Apple Pay. Completing the trip calls settle on the server. This phone does not show an Apple Pay sheet — the rider is not here to authorize one.'

export function tagLabel(id) {
  return TAG_LABELS[id] || String(id)
}

export function tagTone(label) {
  if (/Game|Weekend|Tesla|Student|Preferred/.test(String(label || ''))) return 'orange'
  return 'purple'
}

export const PREFERRED_REQUEST_NOTE =
  'A rider preferred you. Declining cancels their request. It does not return to the open pool.'

export function preferredRequestNote(card) {
  if (!card?.tags?.includes('direct')) return null
  return PREFERRED_REQUEST_NOTE
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
  if (meta.kind === 'carpool' || meta.carpool || meta.fare_breakdown?.carpool) {
    tags.push('carpool')
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
      return 'A rider preferred you'
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

export function driverStatusDetail(status) {
  switch (status) {
    case 'requested':
      return 'Accept to head to pickup. Declining cancels this request. It does not return to the open pool.'
    case 'searching':
    case 'offered':
      return 'Accept to take this ride. Declining leaves it in the open pool for another driver.'
    case 'scheduled':
      return 'This pickup is on the calendar. Accepting keeps it on your upcoming list.'
    case 'accepted':
      return 'Head to pickup. The time on this screen is a straight-line estimate from the coordinates already shared.'
    case 'arriving':
      return 'You are on the way. Mark that you are here when you reach pickup.'
    case 'arrived':
      return 'You are at pickup. Start the trip once the rider is in the car.'
    case 'in_progress':
      return 'The trip is underway. Head to drop-off, then complete it.'
    case 'completed':
      return 'This trip is complete.'
    case 'canceled':
    case 'cancelled_wait':
      return 'This trip is canceled.'
    default:
      return 'Trip status updates as you move through the ride.'
  }
}

export function acceptActionLabel(status) {
  switch (status) {
    case 'scheduled':
      return 'Accept scheduled ride'
    case 'requested':
      return 'Accept preferred ride'
    case 'searching':
    case 'offered':
      return 'Accept'
    default:
      return 'Accept'
  }
}

/** Open-pool and preferred accepts require driver_status.online. Scheduled rides do not. */
export function acceptNeedsDriverOnline(status) {
  switch (status) {
    case 'searching':
    case 'offered':
    case 'requested':
      return true
    default:
      return false
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
    depositExplicit: row.deposit_cents != null && row.deposit_cents !== '',
    driverNetCents: tripEarnedCents(row),
    ...carpoolCardFields(row),
    firstName: first,
    purpose: meta.purpose || row.rider_note || '',
    tier: row.tier || null,
    tags,
    tagLabels: tags.map(tagLabel),
    teslaStub: tags.includes('tesla'),
    arrivedAt: row.arrived_at || null,
    passengers: Math.max(1, Math.round(Number(row.passengers) || 1)),
    shares: carpoolShareLines(meta),
    riderLat: readLiveLat(meta),
    riderLng: readLiveLng(meta),
  }
}

function readLiveLat(meta) {
  const live = meta.rider_location || meta.riderLocation || null
  const lat = live?.lat ?? live?.latitude ?? meta.rider_lat
  return lat != null && Number.isFinite(Number(lat)) ? Number(lat) : null
}

function readLiveLng(meta) {
  const live = meta.rider_location || meta.riderLocation || null
  const lng = live?.lng ?? live?.longitude ?? meta.rider_lng
  return lng != null && Number.isFinite(Number(lng)) ? Number(lng) : null
}

export function carpoolShareLines(metadata) {
  const meta = metadata && typeof metadata === 'object' ? metadata : {}
  const raw = meta.fare_breakdown?.carpool?.shares || meta.carpool?.shares || []
  if (!Array.isArray(raw)) return []
  return raw.map((share, index) => ({
    id: String(share?.id || index),
    label: String(share?.label || share?.name || `Rider ${index + 1}`),
    shareCents: Math.max(0, Math.round(Number(share?.shareCents ?? share?.amountCents) || 0)),
  }))
}

function carpoolCardFields(row) {
  const pay = carpoolPayFromTrip(row)
  if (!pay?.showBonus) {
    return { baseNetCents: null, carpoolBonusCents: null, carpoolIncentiveId: null, driverPayoutCents: pay?.payoutCents ?? null }
  }
  return {
    baseNetCents: pay.baseNetCents,
    carpoolBonusCents: pay.bonusCents,
    carpoolIncentiveId: pay.incentiveId || DRIVER_CARPOOL_BONUS_ID,
    driverPayoutCents: pay.payoutCents,
  }
}

/** Fare, 25% deposit, remainder still collected on complete, and the 80/20 split. */
export function fareCollection(card) {
  const shares = Array.isArray(card?.shares) ? card.shares : carpoolShareLines(card?.metadata)
  const shareSum = shares.reduce((sum, share) => sum + (Number(share.shareCents) || 0), 0)
  const listed = Math.max(0, Math.round(Number(card?.fareCents ?? card?.fare_cents) || 0))
  const fareCents = shareSum > 0 ? shareSum : listed
  const depositCents = card?.depositExplicit
    ? Math.max(0, Math.round(Number(card.depositCents ?? card.deposit_cents) || 0))
    : depositSliceCents(fareCents, shareSum > 0 ? card?.deposit_cents : (card?.depositCents ?? card?.deposit_cents))
  const pay = carpoolPayFromTrip(card)
  const net = pay ? pay.payoutCents : driverNetCents(fareCents)
  return {
    fareCents,
    depositCents,
    remainderCents: Math.max(0, fareCents - depositCents),
    driverNetCents: net,
    platformFeeCents: Math.max(0, fareCents - net),
    shares,
    baseNetCents: pay?.showBonus ? pay.baseNetCents : null,
    carpoolBonusCents: pay?.showBonus ? pay.bonusCents : null,
    carpoolIncentiveId: pay?.showBonus ? (pay.incentiveId || DRIVER_CARPOOL_BONUS_ID) : null,
    usesStoredPayout: Boolean(pay),
  }
}

const WEEKDAY_MON0 = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }

function zonedDateKey(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/** Monday–Sunday in America/New_York, compared by the zoned calendar date of each Monday. */
export function isSameZonedWeek(iso, now = new Date(), timeZone = 'America/New_York') {
  if (!iso) return false
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return false
  const shift = (value) => {
    const parts = zonedWeekdayHour(value.toISOString(), timeZone)
    const index = parts ? WEEKDAY_MON0[parts.weekday] ?? 0 : 0
    return new Date(value.getTime() - index * 24 * 60 * 60 * 1000)
  }
  return zonedDateKey(shift(date), timeZone) === zonedDateKey(shift(now), timeZone)
}

export function weekNetCents(trips, now = new Date()) {
  let total = 0
  for (const trip of trips || []) {
    if (trip?.status && trip.status !== 'completed') continue
    if (!isSameZonedWeek(trip?.completed_at, now)) continue
    total += tripEarnedCents(trip)
  }
  return total
}

/** Open-pool declines go back to searching. A rider who chose this driver is canceled. Scheduled stays listed. */
export function declineDisposition(status) {
  switch (status) {
    case 'searching':
    case 'offered':
      return 'release'
    case 'scheduled':
      return 'leave'
    case 'requested':
      return 'cancel'
    default:
      return 'cancel'
  }
}

/** Button copy for declineDisposition. Preferred requests cancel. Open-pool requests go back to searching. */
export function declineActionLabel(status) {
  const disposition = declineDisposition(status)
  switch (disposition) {
    case 'cancel':
      return 'Decline and cancel'
    case 'release':
      return 'Decline'
    case 'leave':
      return 'Not this one'
    default: {
      const unknown = disposition
      throw new Error(`Unknown decline disposition: ${unknown}`)
    }
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

/** Empty-state copy for the driver queue. Filters stay student, game day, and weekend. */
export function queueEmptyCopy(filter) {
  switch (filter) {
    case 'all':
      return {
        title: 'Queue is clear',
        body: 'Open requests and scheduled pickups show up here. Go online so riders can choose you.',
      }
    case 'student':
      return {
        title: 'No student rides',
        body: 'Clemson student discounts show up in this filter. Other requests stay on All.',
      }
    case 'game_day':
      return {
        title: 'No game-day rides',
        body: 'Stadium and tailgate rides show up here when the trip is marked game day.',
      }
    case 'weekend_party':
      return {
        title: 'No weekend or party rides',
        body: 'Friday evening through Sunday airport and campus pickups show up here, including ones riders schedule ahead.',
      }
    default: {
      const unknown = filter
      throw new Error(`Unknown queue filter: ${unknown}`)
    }
  }
}

export function scheduledQueueTitle(filter) {
  return filter === 'weekend_party' ? 'Scheduled weekend and party rides' : 'Scheduled'
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
      const net = tripEarnedCents(trip)
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
