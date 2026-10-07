/**
 * Driver offer ladder.
 * First (exclusive) offer: driver nets 80% for 15 seconds.
 * Then the open pool: driver nets 70% for two minutes, then the offer expires.
 * Scheduled rides stay on their own board and net 75%.
 */
import { estimateLeg, hourlyRateCents } from '../../src/lib/rideGeometry.js'
import { driverBoostShareCents, readBoostCents } from '../../shared/scheduledBoost.js'

export const EXCLUSIVE_SECONDS = 15
export const POOL_SECONDS = 120
export const EXCLUSIVE_SHARE_BPS = 8000
export const POOL_SHARE_BPS = 7000
export const SCHEDULED_SHARE_BPS = 7500

export const RIDE_ALERT_TIERS = Object.freeze(['standard', 'wait', 'comfort'])
export const RIDE_ALERT_MODES = Object.freeze(['chime_vibrate', 'chime', 'vibrate', 'silent'])

const PHASES = new Set(['exclusive', 'pool', 'scheduled', 'expired'])

function metaOf(trip) {
  const meta = trip?.metadata
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {}
}

function fareCentsOf(card) {
  return Math.max(0, Math.round(Number(card?.fareCents ?? card?.fare_cents) || 0))
}

export function shareBpsForPhase(phase) {
  switch (phase) {
    case 'exclusive':
      return EXCLUSIVE_SHARE_BPS
    case 'pool':
      return POOL_SHARE_BPS
    case 'scheduled':
      return SCHEDULED_SHARE_BPS
    case 'expired':
      return POOL_SHARE_BPS
    default: {
      const unknown = phase
      return unknown == null ? EXCLUSIVE_SHARE_BPS : EXCLUSIVE_SHARE_BPS
    }
  }
}

/** 80% matches driverNetCents (fare minus a once-rounded 20% fee). */
export function netCentsForShare(fareCents, shareBps) {
  const fare = Math.max(0, Math.round(Number(fareCents) || 0))
  const bps = Math.max(0, Math.min(10000, Math.round(Number(shareBps) || 0)))
  if (bps === EXCLUSIVE_SHARE_BPS) return fare - Math.round(fare * 0.2)
  return Math.round((fare * bps) / 10000)
}

export function rideAlertTier(tier) {
  if (tier === 'wait' || tier === 'comfort' || tier === 'standard') return tier
  return 'standard'
}

export function rideAlertMode(mode) {
  if (mode === 'chime_vibrate' || mode === 'chime' || mode === 'vibrate' || mode === 'silent') return mode
  return 'chime_vibrate'
}

export function defaultRideAlerts() {
  return { standard: 'chime_vibrate', wait: 'chime_vibrate', comfort: 'chime_vibrate' }
}

export function normalizeRideAlerts(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const defaults = defaultRideAlerts()
  return {
    standard: rideAlertMode(source.standard || defaults.standard),
    wait: rideAlertMode(source.wait || defaults.wait),
    comfort: rideAlertMode(source.comfort || defaults.comfort),
  }
}

export function alertPlayback(mode) {
  const resolved = rideAlertMode(mode)
  switch (resolved) {
    case 'chime_vibrate':
      return { sound: true, vibrate: true }
    case 'chime':
      return { sound: true, vibrate: false }
    case 'vibrate':
      return { sound: false, vibrate: true }
    case 'silent':
      return { sound: false, vibrate: false }
    default: {
      const unknown = resolved
      throw new Error(`Unknown ride alert mode: ${String(unknown)}`)
    }
  }
}

export function playbackForTier(alerts, tier) {
  const prefs = normalizeRideAlerts(alerts)
  return alertPlayback(prefs[rideAlertTier(tier)])
}

export function explicitOfferPhase(trip) {
  const phase = metaOf(trip).offer_phase || trip?.offerPhase || trip?.offer_phase
  if (PHASES.has(phase)) return phase
  if (trip?.status === 'scheduled') return 'scheduled'
  return null
}

export function isPoolPhase(trip) {
  return explicitOfferPhase(trip) === 'pool'
}

export function exclusiveOfferPatch() {
  return { offer_phase: 'exclusive', offer_share_bps: EXCLUSIVE_SHARE_BPS }
}

export function poolOfferPatch(now = new Date()) {
  const at = now instanceof Date ? now : new Date(now)
  return {
    offer_phase: 'pool',
    offer_share_bps: POOL_SHARE_BPS,
    offer_driver_id: null,
    match: 'open',
    pool_started_at: at.toISOString(),
  }
}

export function scheduledOfferPatch() {
  return { offer_phase: 'scheduled', offer_share_bps: SCHEDULED_SHARE_BPS }
}

export function poolDeadlineIso(now = new Date()) {
  const base = now instanceof Date ? now.getTime() : new Date(now).getTime()
  return new Date(base + POOL_SECONDS * 1000).toISOString()
}

/**
 * How long a driver_request card stays on screen after its exclusive deadline.
 * The 15-second window retargets the offer into the pool; it does not dismiss the card.
 * Returns null when this row is not on the ladder.
 */
export function ladderCardVisibleUntilMs(trip) {
  const meta = metaOf(trip)
  if (meta.kind !== 'driver_request') return null
  if (meta.offer_phase === 'expired' || meta.cancel_reason === 'offer_expired') return 0
  const expires = Date.parse(trip?.offer_expires_at || '')
  if (!Number.isFinite(expires)) return null
  if (meta.offer_phase === 'pool') return expires
  if (meta.offer_driver_id || meta.offer_phase === 'exclusive') return expires + POOL_SECONDS * 1000
  return null
}

export function ladderOfferNet(card) {
  const phase = explicitOfferPhase(card)
  if (!phase || phase === 'expired') return null
  const shareBps = Number(card?.offerShareBps ?? card?.offer_share_bps ?? metaOf(card).offer_share_bps) || shareBpsForPhase(phase)
  const netCents = netCentsForShare(fareCentsOf(card), shareBps)
  const percent = Math.round(shareBps / 100)
  let subtext = `First offer · you net ${percent}%`
  if (phase === 'pool') subtext = `Open pool · you net ${percent}%`
  if (phase === 'scheduled') subtext = `Scheduled pool · you net ${percent}%`
  return { phase, shareBps, netCents, percent, subtext, platformFeeCents: Math.max(0, fareCentsOf(card) - netCents) }
}

export function lockedOfferEconomics(trip) {
  const view = ladderOfferNet(trip?.fare_cents != null ? { ...trip, fareCents: trip.fare_cents, status: trip.status, metadata: trip.metadata } : trip)
  if (!view) return null
  return view
}

export function offerHourly(card, driver) {
  const priced = ladderOfferNet(card)
  const net = (priced ? priced.netCents : fareCentsOf(card)) + driverBoostShareCents(readBoostCents(card))
  const pickup = card?.pickupLat != null && card?.pickupLng != null ? [Number(card.pickupLat), Number(card.pickupLng)] : null
  const drop = card?.dropoffLat != null && card?.dropoffLng != null ? [Number(card.dropoffLat), Number(card.dropoffLng)] : null
  const self = driver?.lat != null && driver?.lng != null ? [Number(driver.lat), Number(driver.lng)] : null
  const toPickup = self && pickup ? estimateLeg(self, pickup) : null
  const routed = Number(card?.routeDurationS)
  const trip = Number.isFinite(routed) && routed > 0 ? { seconds: routed } : (pickup && drop ? estimateLeg(pickup, drop) : null)
  return hourlyRateCents(net, toPickup?.seconds || 0, trip?.seconds || 0)
}

export function formatHourlyRate(cents) {
  const n = Math.max(0, Math.round(Number(cents) || 0))
  return `$${(n / 100).toFixed(0)}/hr`
}

export function pickupMiles(card, driver) {
  if (driver?.lat == null || driver?.lng == null || card?.pickupLat == null || card?.pickupLng == null) return null
  const leg = estimateLeg([Number(driver.lat), Number(driver.lng)], [Number(card.pickupLat), Number(card.pickupLng)])
  if (!leg) return null
  return leg.meters / 1609.344
}

export function exclusiveSecondsLeft(card, nowMs = Date.now()) {
  const phase = explicitOfferPhase(card)
  if (phase === 'pool' || phase === 'scheduled' || phase === 'expired') return null
  const expires = Date.parse(card?.offerExpiresAt || card?.offer_expires_at || '')
  if (!Number.isFinite(expires)) return null
  return Math.max(0, Math.round((expires - nowMs) / 1000))
}

export function poolSecondsLeft(card, nowMs = Date.now()) {
  if (explicitOfferPhase(card) !== 'pool') return null
  const expires = Date.parse(card?.offerExpiresAt || card?.offer_expires_at || '')
  if (!Number.isFinite(expires)) return null
  return Math.max(0, Math.round((expires - nowMs) / 1000))
}
