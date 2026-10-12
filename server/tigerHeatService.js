/**
 * Tiger Heat Map service: score zones, throttle them against the margin
 * ledger, and reserve or settle the flat driver bonus.
 *
 * Preview windows never reserve pay. Live zones reserve only after the
 * solvency check. Duration dollars are applied when the trip completes,
 * then checked again so a long game-day ride cannot overdraw the ledger.
 */

import { splitPlatformFee } from '../src/lib/fareRates.js'
import {
  BONUS_CAP_CENTS,
  DURATION_BASELINE_MINUTES,
  DURATION_CENTS_PER_MINUTE,
  DURATION_GAME_DAY_CENTS_PER_MINUTE,
  LIVE_WINDOW_MS,
  applyDurationBonus,
  bestPayableZone,
  evaluateTigerHeat,
  heatWindowActivation,
  resizeZone,
  tigerHeatAnchor,
  tripDurationMinutes,
} from '../packages/rides-native/tigerHeat.js'
import {
  resolveTigerHeatConfig,
  settleDecoupledFare,
  throttleBonus,
} from './tigerHeatFunding.js'
import {
  commitEntry,
  ledgerExcluding,
  loadLedger,
  loadTigerHeatConfigRow,
  newReservationId,
  withLedgerLock,
} from './tigerHeatLedger.js'

export const DURATION_POLICY = {
  baselineMinutes: DURATION_BASELINE_MINUTES,
  centsPerMinute: DURATION_CENTS_PER_MINUTE,
  gameDayCentsPerMinute: DURATION_GAME_DAY_CENTS_PER_MINUTE,
  capCents: BONUS_CAP_CENTS,
  note: 'Flat dollars added for minutes past the baseline. Game day uses the higher per-minute amount. Capped at $30.',
}

async function configFor(sb, override) {
  if (override) return override
  const row = await loadTigerHeatConfigRow(sb)
  return resolveTigerHeatConfig(process.env, row)
}

export async function loadPickupRequests(sb, fromIso) {
  if (!sb?.from) return []
  try {
    let query = sb.from('trips').select('id, pickup_lat, pickup_lng, created_at')
    if (typeof query.gte === 'function') query = query.gte('created_at', fromIso)
    if (typeof query.limit === 'function') query = query.limit(1000)
    const result = await query
    if (!result || result.error || !Array.isArray(result.data)) return []
    const fromMs = Date.parse(fromIso)
    return result.data.filter((row) => {
      const lat = Number(row.pickup_lat)
      const lng = Number(row.pickup_lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
      if (Number.isFinite(fromMs) && row.created_at) {
        const stamp = Date.parse(row.created_at)
        if (Number.isFinite(stamp) && stamp < fromMs) return false
      }
      return true
    }).map((row) => ({
      lat: Number(row.pickup_lat),
      lng: Number(row.pickup_lng),
      at: row.created_at || null,
    }))
  } catch {
    return []
  }
}

function applySolvencyToZones(evaluated, ledger, config) {
  const zones = []
  const deactivated = []
  let running = {
    revenueCents: ledger.revenueCents,
    driverPayCents: ledger.driverPayCents,
    marginCents: ledger.marginCents,
  }
  const ordered = [...evaluated.zones].sort((a, b) => Number(b.payable) - Number(a.payable) || b.bonusCents - a.bonusCents)
  for (const zone of ordered) {
    if (!zone.payable) {
      zones.push(zone)
      continue
    }
    const decision = throttleBonus({
      requestedCents: zone.bonusCents,
      ledger: running,
      config,
      riderFareCents: config.referenceFareCents,
      stage: 'zone',
      zoneId: zone.id,
    })
    if (decision.grantedCents <= 0) {
      deactivated.push({
        id: zone.id,
        name: zone.name,
        requestedCents: decision.requestedCents,
        reason: 'solvency',
      })
      continue
    }
    const quote = settleDecoupledFare({
      riderFareCents: config.referenceFareCents,
      bonusCents: decision.grantedCents,
      insuranceBps: config.insuranceBps,
      taxBps: config.taxBps,
    })
    running = {
      revenueCents: running.revenueCents + quote.revenueCents,
      driverPayCents: running.driverPayCents + quote.driverEarningsCents,
      marginCents: running.marginCents + quote.marginDeltaCents,
    }
    const ratio = decision.requestedCents > 0 ? decision.grantedCents / decision.requestedCents : 1
    const next = decision.throttled
      ? resizeZone(zone, zone.radius * ratio, decision.grantedCents)
      : { ...zone }
    next.solvency = decision
    next.payable = true
    next.preview = false
    zones.push(next)
  }
  return { zones, deactivated }
}

export async function buildTigerHeatMap({
  sb = null,
  windowId = 'now',
  now = new Date(),
  requests = null,
  config = null,
} = {}) {
  const resolved = await configFor(sb, config)
  const activation = heatWindowActivation(windowId)
  const at = tigerHeatAnchor(windowId, now)
  let points = requests
  if (!points) {
    if (activation === 'preview-clock') points = []
    else {
      const span = windowId === 'last_7d' ? 7 * 864e5 : LIVE_WINDOW_MS
      points = await loadPickupRequests(sb, new Date(now.getTime() - span).toISOString())
    }
  }
  const evaluated = evaluateTigerHeat({ at, requests: points, activation })
  const ledger = await loadLedger(sb)
  const gated = activation === 'live'
    ? applySolvencyToZones(evaluated, ledger, resolved)
    : { zones: evaluated.zones, deactivated: [] }
  return {
    label: 'Tiger Heat Map',
    windowId: windowId || 'now',
    activation,
    at: evaluated.at,
    zones: gated.zones,
    deactivated: gated.deactivated,
    solvency: {
      revenueCents: ledger.revenueCents,
      driverPayCents: ledger.driverPayCents,
      marginCents: ledger.marginCents,
      minMarginCents: resolved.minMarginCents,
      minMarginBps: resolved.minMarginBps,
      insuranceBps: resolved.insuranceBps,
      taxBps: resolved.taxBps,
      referenceFareCents: resolved.referenceFareCents,
    },
    durationPolicy: DURATION_POLICY,
  }
}

function settlementFrom(offer, settlement, extra) {
  return {
    reservationId: offer.reservationId,
    zoneId: offer.zoneId,
    zoneName: offer.zoneName,
    payable: true,
    preview: false,
    settled: false,
    released: false,
    demandBonusCents: offer.demandBonusCents,
    bonusCents: settlement.bonusCents,
    bonusLabel: offer.bonusLabel,
    heatLevel: offer.heatLevel,
    riderFareCents: settlement.riderFareCents,
    driverBaseCents: settlement.driverBaseCents,
    driverEarningsCents: settlement.driverEarningsCents,
    platformFeeCents: settlement.platformFeeCents,
    platformFundedCents: settlement.platformFundedCents,
    costToPlatformCents: settlement.costToPlatformCents,
    insuranceCents: settlement.insuranceCents,
    taxCents: settlement.taxCents,
    platformFeeWaived: settlement.platformFeeWaived,
    ...extra,
  }
}

export async function reserveTigerHeatOffer(args = {}) {
  return withLedgerLock(() => reserveTigerHeatOfferUnlocked(args))
}

async function reserveTigerHeatOfferUnlocked({
  sb = null,
  pickupLat,
  pickupLng,
  riderFareCents,
  now = new Date(),
  config = null,
  requests = null,
} = {}) {
  const lat = Number(pickupLat)
  const lng = Number(pickupLng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const map = await buildTigerHeatMap({ sb, windowId: 'now', now, config, requests })
  const zone = bestPayableZone(lat, lng, map.zones)
  if (!zone) return null
  const resolved = await configFor(sb, config)
  const ledger = await loadLedger(sb)
  const decision = throttleBonus({
    requestedCents: zone.bonusCents,
    ledger,
    config: resolved,
    riderFareCents,
    stage: 'reserve',
    zoneId: zone.id,
  })
  if (decision.grantedCents <= 0) return null
  const quote = settleDecoupledFare({
    riderFareCents,
    bonusCents: decision.grantedCents,
    insuranceBps: resolved.insuranceBps,
    taxBps: resolved.taxBps,
  })
  const reservationId = newReservationId()
  await commitEntry(sb, {
    reservationId,
    tripId: null,
    zoneId: zone.id,
    status: 'reserved',
    riderFareCents: quote.riderFareCents,
    insuranceCents: quote.insuranceCents,
    taxCents: quote.taxCents,
    revenueCents: quote.revenueCents,
    driverBaseCents: quote.driverBaseCents,
    bonusCents: quote.bonusCents,
    driverPayCents: quote.driverEarningsCents,
    platformFeeCents: quote.platformFeeCents,
    platformFundedCents: quote.platformFundedCents,
  })
  const labelZone = decision.throttled
    ? resizeZone(zone, zone.radius * (decision.grantedCents / decision.requestedCents), decision.grantedCents)
    : zone
  return settlementFrom(
    {
      reservationId,
      zoneId: zone.id,
      zoneName: zone.name,
      demandBonusCents: zone.bonusCents,
      bonusLabel: labelZone.bonusLabel,
      heatLevel: labelZone.heatLevel,
    },
    quote,
    {
      durationAdjustmentCents: 0,
      durationMinutes: null,
      gameDay: false,
      solvency: decision,
    },
  )
}

export async function releaseTigerHeatReservation(args = {}) {
  return withLedgerLock(() => releaseTigerHeatReservationUnlocked(args))
}

async function releaseTigerHeatReservationUnlocked({ sb = null, trip } = {}) {
  const offer = trip?.metadata?.tiger_heat
  if (!offer?.reservationId || offer.released) return null
  const ledger = await loadLedger(sb)
  const existing = (ledger.entries || []).find((entry) => entry.reservationId === offer.reservationId)
  await commitEntry(sb, {
    ...(existing || {
      reservationId: offer.reservationId,
      tripId: trip?.id || null,
      zoneId: offer.zoneId || null,
      riderFareCents: offer.riderFareCents || 0,
      insuranceCents: offer.insuranceCents || 0,
      taxCents: offer.taxCents || 0,
      revenueCents: 0,
      driverBaseCents: offer.driverBaseCents || 0,
      bonusCents: 0,
      driverPayCents: 0,
      platformFeeCents: 0,
      platformFundedCents: 0,
    }),
    status: 'released',
    revenueCents: 0,
    driverPayCents: 0,
    bonusCents: 0,
  })
  return {
    ...offer,
    released: true,
    settled: false,
    payable: false,
    bonusCents: 0,
  }
}

async function detectGameDay(sb, at) {
  if (!sb?.from) return false
  try {
    const iso = (at instanceof Date ? at : new Date(at)).toISOString()
    let query = sb.from('game_day_events').select('id').eq('active', true)
    if (typeof query.lte === 'function') query = query.lte('starts_at', iso)
    if (typeof query.gte === 'function') query = query.gte('ends_at', iso)
    if (typeof query.limit === 'function') query = query.limit(1)
    const result = await query
    return Array.isArray(result?.data) && result.data.length > 0
  } catch {
    return false
  }
}

export async function settleTigerHeatReservation(args = {}) {
  return withLedgerLock(() => settleTigerHeatReservationUnlocked(args))
}

async function settleTigerHeatReservationUnlocked({
  sb = null,
  trip,
  completedAt = new Date(),
  gameDay,
  config = null,
} = {}) {
  const offer = trip?.metadata?.tiger_heat
  if (!offer?.reservationId || offer.preview || offer.payable === false || offer.released) return null
  if (offer.settled) return offer
  const resolved = await configFor(sb, config)
  const onGameDay = typeof gameDay === 'boolean' ? gameDay : await detectGameDay(sb, completedAt)
  const minutes = tripDurationMinutes(trip, completedAt)
  const grown = applyDurationBonus(offer.bonusCents, minutes, onGameDay)
  const ledger = await loadLedger(sb)
  const open = ledgerExcluding(ledger, offer.reservationId)
  const decision = throttleBonus({
    requestedCents: grown.bonusCents,
    ledger: open,
    config: resolved,
    riderFareCents: offer.riderFareCents ?? trip?.fare_cents,
    driverBaseCents: offer.driverBaseCents,
    stage: 'settle',
    zoneId: offer.zoneId,
  })
  const granted = decision.grantedCents
  const quote = settleDecoupledFare({
    riderFareCents: offer.riderFareCents ?? trip?.fare_cents,
    driverBaseCents: offer.driverBaseCents ?? splitPlatformFee(trip?.fare_cents).driverEarningsCents,
    bonusCents: granted,
    insuranceBps: resolved.insuranceBps,
    taxBps: resolved.taxBps,
  })
  await commitEntry(sb, {
    reservationId: offer.reservationId,
    tripId: trip?.id || null,
    zoneId: offer.zoneId || null,
    status: 'settled',
    riderFareCents: quote.riderFareCents,
    insuranceCents: quote.insuranceCents,
    taxCents: quote.taxCents,
    revenueCents: quote.revenueCents,
    driverBaseCents: quote.driverBaseCents,
    bonusCents: quote.bonusCents,
    driverPayCents: quote.driverEarningsCents,
    platformFeeCents: quote.platformFeeCents,
    platformFundedCents: quote.platformFundedCents,
  })
  const reservedBonus = Math.round(Number(offer.bonusCents) || 0)
  return {
    ...offer,
    settled: true,
    released: false,
    payable: granted > 0,
    bonusCents: quote.bonusCents,
    bonusLabel: granted > 0 ? `Tiger Heat · +$${Math.round(granted / 100)}` : offer.bonusLabel,
    durationMinutes: Math.round(minutes * 10) / 10,
    durationAdjustmentCents: Math.max(0, quote.bonusCents - reservedBonus),
    gameDay: onGameDay,
    riderFareCents: quote.riderFareCents,
    driverBaseCents: quote.driverBaseCents,
    driverEarningsCents: quote.driverEarningsCents,
    platformFeeCents: quote.platformFeeCents,
    platformFundedCents: quote.platformFundedCents,
    costToPlatformCents: quote.costToPlatformCents,
    insuranceCents: quote.insuranceCents,
    taxCents: quote.taxCents,
    platformFeeWaived: quote.platformFeeWaived,
    solvency: decision,
    heatLevel: granted >= 2500 ? 'rare' : granted >= 1500 ? 'great' : granted >= 1000 ? 'peak' : granted > 0 ? 'reduced' : null,
  }
}
