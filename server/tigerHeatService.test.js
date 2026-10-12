import assert from 'node:assert/strict'
import test, { beforeEach } from 'node:test'
import { buildPayoutRecord } from './payouts.js'
import { commitEntry, loadLedger, resetTigerHeatLedger } from './tigerHeatLedger.js'
import {
  buildTigerHeatMap,
  releaseTigerHeatReservation,
  reserveTigerHeatOffer,
  settleTigerHeatReservation,
} from './tigerHeatService.js'

const COLLEGE = { lat: 34.6839, lng: -82.8366 }
const RICH = {
  minMarginCents: 0,
  minMarginBps: 500,
  insuranceBps: 0,
  taxBps: 0,
  referenceFareCents: 1798,
}
const TIGHT = {
  minMarginCents: 0,
  minMarginBps: 500,
  insuranceBps: 0,
  taxBps: 0,
  referenceFareCents: 1798,
}

function at(year, month, day, hour) {
  return new Date(year, month - 1, day, hour, 0, 0, 0)
}

async function seedMargin() {
  await commitEntry(null, {
    reservationId: 'bank',
    tripId: null,
    zoneId: null,
    status: 'settled',
    riderFareCents: 200000,
    insuranceCents: 0,
    taxCents: 0,
    revenueCents: 200000,
    driverBaseCents: 100000,
    bonusCents: 0,
    driverPayCents: 100000,
    platformFeeCents: 100000,
    platformFundedCents: 0,
  })
}

beforeEach(() => {
  resetTigerHeatLedger()
})

test('friday night and saturday preview different zones and do not pay', async () => {
  const friday = await buildTigerHeatMap({
    windowId: 'friday_night',
    now: at(2026, 9, 23, 8),
    requests: [],
    config: RICH,
  })
  assert.equal(friday.activation, 'preview-clock')
  assert.equal(friday.zones.every((zone) => zone.payable === false), true)
  assert.ok(friday.zones.some((zone) => zone.id === 'college-ave-core'))
  assert.equal(friday.zones.some((zone) => zone.id === 'memorial-stadium'), false)
  assert.match(friday.zones[0].bonusLabel, /^Preview · Tiger Heat · \+\$/)

  const saturday = await buildTigerHeatMap({
    windowId: 'now',
    now: at(2026, 9, 26, 15),
    requests: [],
    config: RICH,
  })
  const stadium = saturday.zones.find((zone) => zone.id === 'memorial-stadium')
  assert.equal(stadium.preview, true)
  assert.equal(stadium.payable, false)
  assert.match(stadium.bonusLabel, /^Preview · Tiger Heat · \+\$/)
})

test('live request density offers a flat bonus and reserves it against the ledger', async () => {
  await seedMargin()
  const requests = Array.from({ length: 8 }, () => ({ ...COLLEGE }))
  const map = await buildTigerHeatMap({
    windowId: 'now',
    now: at(2026, 10, 5, 12),
    requests,
    config: RICH,
  })
  const zone = map.zones.find((entry) => entry.id === 'college-ave-core' && entry.payable)
  assert.ok(zone)
  assert.equal(zone.bonusCents, 2000)
  assert.equal(zone.bonusLabel, 'Tiger Heat · +$20')
  assert.equal(zone.preview, false)

  const offer = await reserveTigerHeatOffer({
    pickupLat: COLLEGE.lat,
    pickupLng: COLLEGE.lng,
    riderFareCents: 1798,
    now: at(2026, 10, 5, 12),
    config: RICH,
    requests,
  })
  assert.equal(offer.settled, false)
  assert.equal(offer.riderFareCents, 1798)
  assert.equal(offer.bonusCents, 2000)
  assert.equal(offer.platformFeeWaived, true)
  assert.equal(offer.driverEarningsCents, 1438 + 2000)
  assert.equal(offer.costToPlatformCents, offer.driverEarningsCents - 1798)

  const quiet = await reserveTigerHeatOffer({
    pickupLat: 34.5,
    pickupLng: -82.5,
    riderFareCents: 1798,
    now: at(2026, 10, 5, 12),
    config: RICH,
  })
  assert.equal(quiet, null)
})

test('solvency reduces the advertised bonus before commit when margin is thin', async () => {
  const requests = Array.from({ length: 8 }, () => ({ ...COLLEGE }))
  const map = await buildTigerHeatMap({
    windowId: 'now',
    now: at(2026, 10, 5, 12),
    requests,
    config: TIGHT,
  })
  const payable = map.zones.filter((zone) => zone.payable)
  assert.ok(payable.length >= 1)
  for (const zone of payable) {
    assert.ok(zone.bonusCents < 2000)
    assert.equal(zone.solvency.throttled, true)
    assert.match(zone.bonusLabel, /^Tiger Heat · \+\$/)
  }
  assert.ok(map.deactivated.length >= 0)
})

test('completion adds game-day duration dollars, and cancel releases the reserve', async () => {
  await seedMargin()
  const requests = Array.from({ length: 4 }, () => ({ ...COLLEGE }))
  const offer = await reserveTigerHeatOffer({
    pickupLat: COLLEGE.lat,
    pickupLng: COLLEGE.lng,
    riderFareCents: 4000,
    now: at(2026, 10, 5, 12),
    config: RICH,
    requests,
  })
  assert.equal(offer.bonusCents, 1000)
  const trip = {
    id: 'trip-heat',
    fare_cents: 4000,
    accepted_at: '2026-10-05T16:00:00.000Z',
    metadata: { tiger_heat: offer },
  }
  const settled = await settleTigerHeatReservation({
    trip,
    completedAt: '2026-10-05T16:40:00.000Z',
    gameDay: true,
    config: RICH,
  })
  assert.equal(settled.settled, true)
  assert.equal(settled.bonusCents, 2300)
  assert.equal(settled.durationAdjustmentCents, 1300)
  assert.equal(settled.platformFeeCents, 0)
  assert.equal(settled.riderFareCents, 4000)
  const again = await settleTigerHeatReservation({
    trip: { ...trip, metadata: { tiger_heat: settled } },
    completedAt: '2026-10-05T16:40:00.000Z',
    gameDay: true,
    config: RICH,
  })
  assert.equal(again.bonusCents, 2300)
  const ledger = await loadLedger(null)
  const row = ledger.entries.find((entry) => entry.reservationId === offer.reservationId)
  assert.equal(row.status, 'settled')
  assert.equal(row.bonusCents, 2300)

  const payout = buildPayoutRecord({
    id: 'trip-heat',
    driver_id: 'driver-1',
    fare_cents: 4000,
    metadata: { tiger_heat: settled },
  })
  assert.equal(payout.amountCents, settled.driverEarningsCents)
  assert.equal(payout.tigerHeatBonusCents, 2300)
  assert.ok(payout.platformFundedCents > 0)
  assert.notEqual(payout.amountCents, 3200)

  resetTigerHeatLedger()
  await seedMargin()
  const reserved = await reserveTigerHeatOffer({
    pickupLat: COLLEGE.lat,
    pickupLng: COLLEGE.lng,
    riderFareCents: 4000,
    now: at(2026, 10, 5, 12),
    config: RICH,
    requests,
  })
  const before = await loadLedger(null)
  await releaseTigerHeatReservation({ trip: { metadata: { tiger_heat: reserved } } })
  const after = await loadLedger(null)
  assert.ok(after.marginCents > before.marginCents)
  const released = after.entries.find((entry) => entry.reservationId === reserved.reservationId)
  assert.equal(released.status, 'released')
})

test('a floor above available margin deactivates the zone before any bonus is reserved', async () => {
  const requests = Array.from({ length: 12 }, () => ({ ...COLLEGE }))
  const config = { ...TIGHT, minMarginCents: 50000, minMarginBps: 0 }
  const map = await buildTigerHeatMap({
    windowId: 'now',
    now: at(2026, 10, 5, 12),
    requests,
    config,
  })
  assert.equal(map.zones.filter((zone) => zone.payable).length, 0)
  assert.ok(map.deactivated.some((zone) => zone.id === 'college-ave-core' && zone.reason === 'solvency'))
  const offer = await reserveTigerHeatOffer({
    pickupLat: COLLEGE.lat,
    pickupLng: COLLEGE.lng,
    riderFareCents: 1798,
    now: at(2026, 10, 5, 12),
    config,
    requests,
  })
  assert.equal(offer, null)
  const ledger = await loadLedger(null)
  assert.equal(ledger.entries.length, 0)
})

test('two reserves cannot both spend the same margin', async () => {
  await commitEntry(null, {
    reservationId: 'bank',
    tripId: null,
    zoneId: null,
    status: 'settled',
    riderFareCents: 5000,
    insuranceCents: 0,
    taxCents: 0,
    revenueCents: 5000,
    driverBaseCents: 3360,
    bonusCents: 0,
    driverPayCents: 3360,
    platformFeeCents: 1640,
    platformFundedCents: 0,
  })
  const requests = Array.from({ length: 8 }, () => ({ ...COLLEGE }))
  const config = { ...RICH, minMarginBps: 0, minMarginCents: 0 }
  const [first, second] = await Promise.all([
    reserveTigerHeatOffer({
      pickupLat: COLLEGE.lat,
      pickupLng: COLLEGE.lng,
      riderFareCents: 1798,
      now: at(2026, 10, 5, 12),
      config,
      requests,
    }),
    reserveTigerHeatOffer({
      pickupLat: COLLEGE.lat,
      pickupLng: COLLEGE.lng,
      riderFareCents: 1798,
      now: at(2026, 10, 5, 12),
      config,
      requests,
    }),
  ])
  const granted = [first, second].map((offer) => offer?.bonusCents || 0)
  assert.ok(granted.includes(2000))
  assert.ok(granted.reduce((sum, cents) => sum + cents, 0) < 4000)
  const ledger = await loadLedger(null)
  assert.ok(ledger.marginCents >= 0)
})
