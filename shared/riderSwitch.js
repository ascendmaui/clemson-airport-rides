/**
 * Rules for canceling a matched driver before pickup and asking again.
 * Fee math stays with the pickup wait clock: this path is free, and it
 * closes once the driver marks arrived.
 */
import { fareAuthorizationCents } from './fareAuthorization.js'
import {
  arrivedBlockedLine,
  carpoolSwitchLine,
  holdLine,
  startedBlockedLine,
  switchFeeLine,
  unmatchedLine,
} from './copy/riderSwitch.js'
import { exclusiveOfferPatch, EXCLUSIVE_SHARE_BPS, netCentsForShare, poolOfferPatch, POOL_SHARE_BPS } from '../packages/rides-native/offerLadder.js'
import { OFFERED_RIDE_TIERS, resolveOfferedTier } from './rideOptions.js'
import { backupQueueAfterRiderSwitch, readBackupQueue } from './backupDriverQueue.js'

export const BEFORE_PICKUP_STATUSES = Object.freeze(['accepted', 'arriving'])
export const RIDER_SWITCH_ACTIONS = Object.freeze([
  'cancel',
  'rerequest',
  'switch-driver',
  'switch-tier',
  'open-carpool',
])

export function isRiderSwitchAction(action) {
  return RIDER_SWITCH_ACTIONS.includes(action)
}

export function isBeforePickupMatch(trip) {
  return BEFORE_PICKUP_STATUSES.includes(String(trip?.status || '')) && Boolean(trip?.driver_id)
}

function authOf(trip) {
  const auth = trip?.metadata?.fare_authorization
  return auth && typeof auth === 'object' ? auth : null
}

function openHold(auth) {
  return Boolean(auth && auth.status === 'requires_capture' && auth.paymentIntentId)
}

export function quoteRiderSwitch(trip, { action = 'preview', nextFareCents = null } = {}) {
  const status = String(trip?.status || '')
  if (status === 'arrived' || status === 'cancelled_wait') {
    return blocked('at_pickup', arrivedBlockedLine())
  }
  if (status === 'in_progress' || status === 'canceled_midride') {
    return blocked('in_progress', startedBlockedLine())
  }
  if (!isBeforePickupMatch(trip)) {
    return blocked('not_matched', unmatchedLine())
  }

  const ending = action === 'cancel' || action === 'open-carpool'
  const fare = ending
    ? Math.max(0, Math.round(Number(trip?.fare_cents) || 0))
    : Math.max(0, Math.round(Number(nextFareCents ?? trip?.fare_cents) || 0))
  const auth = authOf(trip)
  const credits = trip?.metadata?.billing_choice === 'credits'
  const currentAuthorizationCents = Math.max(0, Math.round(Number(auth?.authorizationCents) || 0))
  const next = fareAuthorizationCents(fare)
  let hold = 'none'
  if (!credits && openHold(auth) && ending) hold = 'release'
  else if (!credits && openHold(auth) && next.authorizationCents > currentAuthorizationCents) hold = 'grow'
  else if (!credits && openHold(auth)) hold = 'keep'
  else if (!credits && !ending) hold = 'place'
  return {
    allowed: true,
    code: 'before_pickup',
    feeCents: 0,
    grace: 'before_pickup',
    hold,
    action: action === 'preview' ? null : action,
    currentAuthorizationCents,
    nextAuthorizationCents: ending ? 0 : next.authorizationCents,
    feeLine: switchFeeLine(),
    holdLine: holdLine(hold),
    carpoolLine: carpoolSwitchLine(),
  }
}

function blocked(code, message) {
  return {
    allowed: false,
    code,
    feeCents: null,
    grace: null,
    hold: null,
    action: null,
    feeLine: message,
    holdLine: null,
    message,
  }
}

function metaOf(trip) {
  const meta = trip?.metadata
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? { ...meta } : {}
}

function nextDriverFor(action, driverId, drivers, previousDriverId) {
  if (action === 'switch-driver') return driverId || null
  const list = Array.isArray(drivers) ? drivers : []
  const found = list.find((driver) => driver?.id && driver.id !== previousDriverId)
  return found?.id || null
}

/**
 * Build the trip update for a confirmed switch. Does not talk to Stripe.
 * @returns {{ ok: true, quote: object, update: object, notifyDriverId: string | null, event: object, next: string } | { ok: false, status: number, error: string, code: string, quote: object }}
 */
export function commitRiderSwitch({
  trip,
  action,
  driverId = null,
  tier = null,
  drivers = [],
  nextFareCents = null,
  now = new Date().toISOString(),
} = {}) {
  if (!isRiderSwitchAction(action)) {
    const quote = quoteRiderSwitch(trip, { action: 'preview' })
    return { ok: false, status: 400, error: 'Choose what to do with this ride.', code: 'rider_switch_action', quote }
  }

  const ending = action === 'cancel' || action === 'open-carpool'
  let nextTier = trip?.tier || 'standard'
  if (action === 'switch-tier') {
    try {
      nextTier = resolveOfferedTier(tier)
    } catch (error) {
      const quote = quoteRiderSwitch(trip, { action: 'preview' })
      return {
        ok: false,
        status: error.status || 400,
        error: error.message || 'That ride option is not offered.',
        code: error.code || 'ride_option_unavailable',
        quote,
      }
    }
    if (!OFFERED_RIDE_TIERS.includes(nextTier)) {
      const quote = quoteRiderSwitch(trip, { action: 'preview' })
      return { ok: false, status: 400, error: 'That ride option is not offered.', code: 'ride_option_unavailable', quote }
    }
  }

  const fare = ending
    ? Math.max(0, Math.round(Number(trip?.fare_cents) || 0))
    : Math.max(0, Math.round(Number(nextFareCents ?? trip?.fare_cents) || 0))
  const quote = quoteRiderSwitch(trip, { action, nextFareCents: fare })
  if (!quote.allowed) {
    return { ok: false, status: 409, error: quote.message || quote.feeLine, code: quote.code, quote }
  }

  if (action === 'switch-driver') {
    const match = (drivers || []).find((driver) => driver?.id === driverId)
    if (!match || driverId === trip.driver_id) {
      return { ok: false, status: 409, error: 'That driver is not available.', code: 'driver_unavailable', quote }
    }
  }

  const previousDriverId = trip.driver_id
  const meta = metaOf(trip)
  const passed = Array.isArray(meta.offer_passed_driver_ids) ? meta.offer_passed_driver_ids.slice() : []
  if (previousDriverId && !passed.includes(previousDriverId)) passed.push(previousDriverId)
  const seatedBackup = readBackupQueue(trip)
  const switchRecord = {
    at: now,
    action,
    fromDriverId: previousDriverId,
    toDriverId: action === 'switch-driver' ? driverId : null,
    fromTier: trip.tier || 'standard',
    toTier: ending ? (trip.tier || 'standard') : nextTier,
    feeCents: 0,
  }

  const continuingDriverId = ending ? null : nextDriverFor(action, driverId, drivers, previousDriverId)
  const backupQueue = seatedBackup
    ? backupQueueAfterRiderSwitch(seatedBackup, { action, nextDriverId: continuingDriverId, now })
    : null
  const releasedDriverIds = backupQueue?.releasedDriverIds || []
  const metadataBase = backupQueue ? { ...meta, backup_queue: backupQueue } : meta

  if (ending) {
    return {
      ok: true,
      quote,
      notifyDriverId: null,
      releasedDriverIds,
      next: action === 'open-carpool' ? 'carpool' : 'home',
      event: {
        kind: 'canceled',
        payload: {
          reason: action === 'open-carpool' ? 'rider_switch_carpool' : 'rider_switch_cancel',
          driver_id: previousDriverId,
          fee_cents: 0,
          source: 'rider_app',
        },
      },
      update: {
        status: 'canceled',
        driver_id: null,
        canceled_at: now,
        metadata: {
          ...metadataBase,
          offer_driver_id: null,
          offer_passed_driver_ids: passed,
          rider_switch: switchRecord,
        },
      },
    }
  }

  const notifyDriverId = continuingDriverId
  const ladder = notifyDriverId ? exclusiveOfferPatch() : poolOfferPatch(now)
  const shareBps = notifyDriverId ? EXCLUSIVE_SHARE_BPS : POOL_SHARE_BPS
  const net = netCentsForShare(fare, shareBps)
  return {
    ok: true,
    quote,
    notifyDriverId,
    releasedDriverIds,
    next: 'ride',
    event: {
      kind: 'searching',
      payload: {
        reason: 'rider_switch',
        driver_id: notifyDriverId,
        tier: nextTier,
        fee_cents: 0,
        source: 'rider_app',
      },
    },
    update: {
      status: 'searching',
      driver_id: null,
      accepted_at: null,
      tier: nextTier,
      fare_cents: fare,
      deposit_cents: 0,
      platform_fee_cents: Math.max(0, fare - net),
      driver_earnings_cents: net,
      metadata: {
        ...metadataBase,
        ...ladder,
        offer_driver_id: notifyDriverId,
        preferred_driver_id: action === 'switch-driver' ? driverId : null,
        offer_passed_driver_ids: passed,
        match: notifyDriverId ? (action === 'switch-driver' ? 'picked' : 'auto') : 'open',
        ride_option: nextTier,
        rider_switch: switchRecord,
      },
    },
  }
}
