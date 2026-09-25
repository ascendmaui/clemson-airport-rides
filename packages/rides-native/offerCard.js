/**
 * Pure formatting and view-model helpers for the driver offer card.
 *
 * Used by apps/driver/app/(tabs)/index.tsx (RideCard), apps/driver/app/queue.tsx,
 * and web driver screens.
 */
import {
  carpoolPayFromTrip,
  depositSliceCents,
  driverNetCents,
  fareCollection,
  formatCents,
  formatPickupAt,
  isAirportDepositTrip,
  statusHeadline,
  tagLabel,
  tagTone,
} from './tripTags.js'

/** Default time window (in seconds) drivers have to accept an incoming offer. */
export const DEFAULT_OFFER_TTL_SECONDS = 30

/**
 * Shortens a pickup or drop-off location string into a concise label suitable
 * for cards and small mobile screens.
 *
 * Normalizes airport names (e.g. "Greenville-Spartanburg International Airport (GSP)" -> "GSP Airport"),
 * extracts the primary venue or street before city/state commas or bullet notes,
 * and falls back to a clean placeholder when empty.
 */
export function shortPlaceLabel(label, fallback = '') {
  if (label == null || label === '') return fallback
  const raw = String(label).trim()
  if (!raw) return fallback

  // Airport detection
  if (/gsp|greenville[-\s]?spartanburg/i.test(raw)) {
    return 'GSP Airport'
  }
  if (/\bclt\b|charlotte[-\s]?douglas/i.test(raw)) {
    return 'CLT Airport'
  }
  if (/\batl\b|hartsfield[-\s]?jackson/i.test(raw)) {
    return 'ATL Airport'
  }

  // Strip trailing parenthetical notes (e.g. "(Gate 1)")
  let clean = raw.replace(/\s*\([^)]*\)\s*$/, '').trim()

  // If separated by bullet (e.g. "Downtown Clemson · College Ave")
  if (clean.includes(' · ')) {
    const head = clean.split(' · ')[0].trim()
    if (head) return head
  }
  if (clean.includes(' • ')) {
    const head = clean.split(' • ')[0].trim()
    if (head) return head
  }

  // If address contains commas (e.g. "120 College Ave, Clemson, SC 29631")
  if (clean.includes(',')) {
    const head = clean.split(',')[0].trim()
    if (head) return head
  }

  return clean || fallback
}

/** Pickup short label with default fallback "Pickup". */
export function pickupShortLabel(cardOrLabel, fallback = 'Pickup') {
  if (cardOrLabel == null) return fallback
  const raw = typeof cardOrLabel === 'object'
    ? (cardOrLabel.pickupLabel ?? cardOrLabel.pickup_label)
    : cardOrLabel
  return shortPlaceLabel(raw, fallback)
}

/** Drop-off short label with default fallback "Drop-off". */
export function dropoffShortLabel(cardOrLabel, fallback = 'Drop-off') {
  if (cardOrLabel == null) return fallback
  const raw = typeof cardOrLabel === 'object'
    ? (cardOrLabel.dropoffLabel ?? cardOrLabel.dropoff_label)
    : cardOrLabel
  return shortPlaceLabel(raw, fallback)
}

/** Route summary headline, e.g. "Downtown Clemson → GSP Airport". */
export function routeHeadline(cardOrPickup, dropoff) {
  if (cardOrPickup && typeof cardOrPickup === 'object' && dropoff === undefined) {
    const pickup = pickupShortLabel(cardOrPickup)
    const drop = dropoffShortLabel(cardOrPickup)
    return `${pickup} → ${drop}`
  }
  const pickup = pickupShortLabel(cardOrPickup)
  const drop = dropoffShortLabel(dropoff)
  return `${pickup} → ${drop}`
}

/**
 * Driver net earnings details computed using existing tripTags earnings/fee helpers.
 * Never invents numbers.
 */
export function formatDriverNetPay(card) {
  const fare = fareCollection(card)
  const explicitNet = card?.driverNetCents ?? card?.driver_net_cents ?? card?.driverPayoutCents ?? card?.driver_payout_cents
  const netCents = fare.driverNetCents > 0 || explicitNet == null
    ? fare.driverNetCents
    : Math.max(0, Math.round(Number(explicitNet) || 0))

  const formattedNet = formatCents(netCents)
  const isCarpool = Boolean(fare.carpoolIncentiveId)

  let subtext = 'You net 80%'
  if (card?.status) {
    const headline = statusHeadline(card.status)
    if (isCarpool) {
      const baseFormatted = formatCents(fare.baseNetCents || 0)
      const bonusFormatted = formatCents(fare.carpoolBonusCents || 0)
      const incentiveName = fare.carpoolIncentiveId
      subtext = `${headline} · base ${baseFormatted} · ${incentiveName} ${bonusFormatted} · total ${formattedNet}`
    } else {
      subtext = `${headline} · you net 80%`
    }
  } else if (isCarpool) {
    const baseFormatted = formatCents(fare.baseNetCents || 0)
    const bonusFormatted = formatCents(fare.carpoolBonusCents || 0)
    const incentiveName = fare.carpoolIncentiveId
    subtext = `Base ${baseFormatted} · ${incentiveName} ${bonusFormatted} · total ${formattedNet}`
  }

  return {
    netCents,
    formattedNet,
    baseNetCents: fare.baseNetCents ?? null,
    formattedBaseNet: fare.baseNetCents != null ? formatCents(fare.baseNetCents) : null,
    carpoolBonusCents: fare.carpoolBonusCents ?? null,
    formattedCarpoolBonus: fare.carpoolBonusCents != null ? formatCents(fare.carpoolBonusCents) : null,
    carpoolIncentiveId: fare.carpoolIncentiveId ?? null,
    isCarpool,
    platformFeeCents: fare.platformFeeCents,
    formattedPlatformFee: formatCents(fare.platformFeeCents),
    subtext,
  }
}

/** Quick formatted driver net pay string (e.g. "$54.40"). */
export function driverNetPayText(card) {
  return formatDriverNetPay(card).formattedNet
}

/**
 * Formats ETA minutes (e.g. 4 -> "4 min away", 1 -> "1 min away", 0 -> "< 1 min away").
 * Returns null if missing or invalid.
 */
export function formatEta(etaMin) {
  if (etaMin == null || etaMin === '') return null
  const min = Math.round(Number(etaMin))
  if (!Number.isFinite(min) || min < 0) return null
  if (min === 0) return '< 1 min away'
  if (min === 1) return '1 min away'
  return `${min} min away`
}

/**
 * Formats distance in miles (e.g. 32 -> "32 mi", 2.4 -> "2.4 mi", 1 -> "1 mi").
 * Returns null if missing or invalid.
 */
export function formatDistance(distanceMi) {
  if (distanceMi == null || distanceMi === '') return null
  const mi = Number(distanceMi)
  if (!Number.isFinite(mi) || mi < 0) return null
  if (mi === 1) return '1 mi'
  if (Number.isInteger(mi)) return `${mi} mi`
  return `${Number(mi.toFixed(1))} mi`
}

/**
 * Combined distance and ETA text (e.g. "4 min away · 32 mi").
 * Accepts either a card object or (etaMin, distanceMi).
 * Returns null if neither is present.
 */
export function formatDistanceEta(cardOrEta, distanceMi) {
  let etaVal = null
  let distVal = null

  if (cardOrEta != null && typeof cardOrEta === 'object') {
    etaVal = cardOrEta.etaMin ?? cardOrEta.eta_min ?? cardOrEta.eta
    distVal = cardOrEta.distanceMi ?? cardOrEta.distance_mi ?? cardOrEta.distance
  } else {
    etaVal = cardOrEta
    distVal = distanceMi
  }

  const etaPart = formatEta(etaVal)
  const distPart = formatDistance(distVal)

  const parts = [etaPart, distPart].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : null
}

/**
 * Formats passenger count into seat label (e.g. 1 -> "1 seat", 3 -> "3 seats").
 * Returns null if missing or <= 0.
 */
export function formatSeats(cardOrCount) {
  let count = null
  if (cardOrCount != null && typeof cardOrCount === 'object') {
    count = cardOrCount.passengers ?? cardOrCount.seats ?? cardOrCount.partySize ?? cardOrCount.party_size
  } else {
    count = cardOrCount
  }
  if (count == null || count === '') return null
  const n = Math.round(Number(count))
  if (!Number.isFinite(n) || n <= 0) return null
  return n === 1 ? '1 seat' : `${n} seats`
}

/** Structured seats view-model object. */
export function seatsViewModel(cardOrCount) {
  let count = null
  if (cardOrCount != null && typeof cardOrCount === 'object') {
    count = cardOrCount.passengers ?? cardOrCount.seats ?? cardOrCount.partySize ?? cardOrCount.party_size
  } else {
    count = cardOrCount
  }
  if (count == null || count === '') {
    return { count: null, seatsLabel: null, ridersLabel: null }
  }
  const n = Math.round(Number(count))
  if (!Number.isFinite(n) || n <= 0) {
    return { count: null, seatsLabel: null, ridersLabel: null }
  }
  return {
    count: n,
    seatsLabel: n === 1 ? '1 seat' : `${n} seats`,
    ridersLabel: n === 1 ? '1 rider' : `${n} riders`,
  }
}

/** Determines if the offer represents an airport trip. */
export function isAirportTrip(card) {
  if (!card) return false
  if (isAirportDepositTrip(card)) return true
  const kind = String(card.rideType || card.purpose || '').toLowerCase()
  if (kind === 'airport') return true
  if (Array.isArray(card.tags) && card.tags.includes('airport')) return true
  if (Array.isArray(card.tagLabels) && card.tagLabels.includes('Airport')) return true
  const labels = `${card.pickupLabel || card.pickup_label || ''} ${card.dropoffLabel || card.dropoff_label || ''}`
  return /gsp|clt|atl|airport/i.test(labels)
}

/** Detects airport code (GSP, CLT, ATL) from card fields. */
function detectAirportCode(card) {
  const combined = `${card?.pickupLabel || card?.pickup_label || ''} ${card?.dropoffLabel || card?.dropoff_label || ''}`
  if (/gsp|greenville[-\s]?spartanburg/i.test(combined)) return 'GSP'
  if (/\bclt\b|charlotte[-\s]?douglas/i.test(combined)) return 'CLT'
  if (/\batl\b|hartsfield/i.test(combined)) return 'ATL'
  return null
}

/** Airport badge object, or null if not an airport ride. */
export function airportBadge(card) {
  if (!isAirportTrip(card)) return null
  const code = detectAirportCode(card)
  return {
    id: 'airport',
    label: code ? `${code} Airport` : 'Airport',
    code,
    tone: 'purple',
  }
}

/** Deposit badge object, or null if no deposit is present. */
export function depositBadge(card) {
  if (!card) return null
  let cents = card.depositCents ?? card.deposit_cents
  if (cents == null && (card.fareCents != null || card.fare_cents != null)) {
    cents = depositSliceCents(card.fareCents ?? card.fare_cents, card.deposit_cents)
  }
  const depositCents = Math.max(0, Math.round(Number(cents) || 0))
  if (depositCents <= 0) return null

  const formattedAmount = formatCents(depositCents)
  return {
    id: 'deposit',
    label: `25% deposit · ${formattedAmount}`,
    shortLabel: '25% deposit',
    amountCents: depositCents,
    formattedAmount,
    tone: 'orange',
  }
}

/** All relevant badge chips for an offer card. */
export function offerBadges(card) {
  if (!card) return []
  const badges = []

  const airport = airportBadge(card)
  if (airport) badges.push(airport)

  const deposit = depositBadge(card)
  if (deposit) badges.push(deposit)

  // Include tags present on the card (avoid duplicates of airport)
  const tags = Array.isArray(card.tags) ? card.tags : []
  const tagLabels = Array.isArray(card.tagLabels) ? card.tagLabels : tags.map(tagLabel)
  tagLabels.forEach((label) => {
    if (label.toLowerCase() === 'airport' && airport) return
    badges.push({
      id: label.toLowerCase().replace(/\s+/g, '_'),
      label,
      tone: tagTone(label),
    })
  })

  return badges
}

/**
 * Calculates remaining seconds to accept an offer.
 * Returns null if no expiration information is present.
 */
export function timeLeftToAcceptSeconds(cardOrSeconds, options = {}) {
  if (cardOrSeconds == null) return null
  if (typeof cardOrSeconds === 'number') {
    return Math.round(cardOrSeconds)
  }
  if (typeof cardOrSeconds === 'object') {
    if (cardOrSeconds.secondsLeft != null) {
      const s = Number(cardOrSeconds.secondsLeft)
      return Number.isFinite(s) ? Math.round(s) : null
    }
    if (cardOrSeconds.seconds_left != null) {
      const s = Number(cardOrSeconds.seconds_left)
      return Number.isFinite(s) ? Math.round(s) : null
    }

    const now = options.now ? new Date(options.now).getTime() : Date.now()
    const expStr = cardOrSeconds.expiresAt || cardOrSeconds.expires_at
    if (expStr) {
      const expires = new Date(expStr).getTime()
      if (Number.isFinite(expires)) {
        return Math.round((expires - now) / 1000)
      }
    }

    const offeredStr = cardOrSeconds.offeredAt || cardOrSeconds.offered_at || cardOrSeconds.requested_at
    if (offeredStr) {
      const offered = new Date(offeredStr).getTime()
      const ttl = options.ttlSeconds ?? DEFAULT_OFFER_TTL_SECONDS
      if (Number.isFinite(offered)) {
        return Math.round((offered + ttl * 1000 - now) / 1000)
      }
    }
  }
  return null
}

/**
 * Formats time-left-to-accept countdown label.
 * e.g. 15 -> "15s to accept", 0 -> "Offer expired", 75 -> "1m 15s to accept".
 * Returns null if no countdown information is present.
 */
export function timeLeftToAcceptLabel(cardOrSeconds, options = {}) {
  const seconds = timeLeftToAcceptSeconds(cardOrSeconds, options)
  if (seconds == null) return null
  if (seconds <= 0) return 'Offer expired'
  if (seconds < 60) return `${seconds}s to accept`

  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (s === 0) return `${m}m to accept`
  return `${m}m ${s}s to accept`
}

/** Checks whether an offer has expired. */
export function isOfferExpired(cardOrSeconds, options = {}) {
  const seconds = timeLeftToAcceptSeconds(cardOrSeconds, options)
  if (seconds == null) return false
  return seconds <= 0
}

/**
 * Combined accessibility summary describing the offer for assistive technologies.
 * e.g. "Ride offer: $54.40 net pay. From Tillman Hall to GSP Airport. Rider Ava, 4.9 rating. 4 min away · 32 mi. 1 seat. 25% deposit · $17.00."
 */
export function offerAccessibilityLabel(cardOrVm, options = {}) {
  if (!cardOrVm) return 'Ride offer: $0.00 net pay. From Pickup to Drop-off'
  const vm = (cardOrVm.pay && cardOrVm.pickup && cardOrVm.dropoff && cardOrVm.rider)
    ? cardOrVm
    : offerCardViewModel(cardOrVm, options)

  const parts = []

  const net = vm.pay?.formattedNet || '$0.00'
  parts.push(`Ride offer: ${net} net pay`)

  const pickup = vm.pickup?.shortLabel || vm.pickup?.label || 'Pickup'
  const dropoff = vm.dropoff?.shortLabel || vm.dropoff?.label || 'Drop-off'
  parts.push(`From ${pickup} to ${dropoff}`)

  const rider = vm.rider?.firstName
  const rating = vm.rider?.ratingText ?? (vm.rider?.rating != null ? String(vm.rider.rating) : null)
  if (rider && rider !== 'Rider') {
    parts.push(rating ? `Rider ${rider}, ${rating} rating` : `Rider ${rider}`)
  } else if (rating) {
    parts.push(`Rider rating ${rating}`)
  }

  if (vm.distanceEta) {
    parts.push(vm.distanceEta)
  }

  if (vm.seats?.seatsLabel) {
    parts.push(vm.seats.seatsLabel)
  }

  if (vm.airport?.label && !pickup.includes(vm.airport.label) && !dropoff.includes(vm.airport.label)) {
    parts.push(vm.airport.label)
  }

  if (vm.deposit?.label) {
    parts.push(vm.deposit.label)
  }

  if (vm.pickupAtText) {
    parts.push(vm.pickupAtText)
  }

  if (vm.timeLeft?.label) {
    parts.push(vm.timeLeft.label)
  }

  return parts.join('. ')
}

/**
 * Unified pure view-model helper for the driver offer card.
 * Gathers and formats all fields into a single presentation-ready structure.
 */
export function offerCardViewModel(card, options = {}) {
  const pickup = {
    label: card?.pickupLabel || card?.pickup_label || 'Pickup',
    shortLabel: pickupShortLabel(card),
  }
  const dropoff = {
    label: card?.dropoffLabel || card?.dropoff_label || 'Drop-off',
    shortLabel: dropoffShortLabel(card),
  }
  const headline = routeHeadline(card)

  const pay = formatDriverNetPay(card)
  const distanceEta = formatDistanceEta(card)
  const eta = formatEta(card?.etaMin ?? card?.eta_min ?? card?.eta)
  const distance = formatDistance(card?.distanceMi ?? card?.distance_mi ?? card?.distance)
  const seats = seatsViewModel(card)

  const badges = offerBadges(card)
  const airport = airportBadge(card)
  const deposit = depositBadge(card)
  const airportTrip = isAirportTrip(card)

  const secondsLeft = timeLeftToAcceptSeconds(card, options)
  const timeLabel = timeLeftToAcceptLabel(card, options)
  const expired = isOfferExpired(card, options)

  const timeLeft = timeLabel != null ? {
    seconds: secondsLeft,
    label: timeLabel,
    isExpired: expired,
    isUrgent: secondsLeft != null && secondsLeft > 0 && secondsLeft <= 10,
  } : null

  const vmWithoutLabel = {
    id: card?.id ?? null,
    status: card?.status ?? 'offered',
    rider: {
      firstName: card?.firstName || card?.rider_first_name || 'Rider',
      rating: card?.riderRating != null ? Number(card.riderRating) : null,
      ratingText: card?.riderRating != null ? card.riderRating.toFixed(1) : null,
      rideType: card?.rideType || card?.purpose || null,
    },
    pickup,
    dropoff,
    routeHeadline: headline,
    pay,
    distanceEta,
    eta,
    distance,
    seats,
    badges,
    airport,
    deposit,
    isAirport: airportTrip,
    timeLeft,
    timeLeftLabel: timeLabel,
    pickupAtText: card?.pickupAt ? formatPickupAt(card.pickupAt) : null,
  }

  return {
    ...vmWithoutLabel,
    accessibilityLabel: offerAccessibilityLabel(vmWithoutLabel, options),
  }
}

/** Alias to offerCardViewModel. */
export const formatOfferCard = offerCardViewModel
