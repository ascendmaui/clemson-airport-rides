import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EXCLUSIVE_SECONDS,
  POOL_SECONDS,
  alertPlayback,
  exclusiveOfferPatch,
  exclusiveSecondsLeft,
  formatHourlyRate,
  ladderCardVisibleUntilMs,
  ladderOfferNet,
  netCentsForShare,
  normalizeRideAlerts,
  rideAlertTier,
  offerHourly,
  pickupMiles,
  poolOfferPatch,
  scheduledOfferPatch,
} from './offerLadder.js'

test('offer ladder prices exclusive, pool, and scheduled shares', () => {
  assert.equal(EXCLUSIVE_SECONDS, 15)
  assert.equal(POOL_SECONDS, 120)
  assert.equal(netCentsForShare(10000, 8000), 8000)
  assert.equal(netCentsForShare(10000, 7000), 7000)
  assert.equal(netCentsForShare(10000, 7500), 7500)
  const exclusive = ladderOfferNet({ fareCents: 6800, status: 'searching', metadata: exclusiveOfferPatch() })
  assert.equal(exclusive.phase, 'exclusive')
  assert.equal(exclusive.netCents, 6800 - Math.round(6800 * 0.2))
  assert.match(exclusive.subtext, /80%/)
  const pool = ladderOfferNet({ fareCents: 6800, status: 'searching', metadata: poolOfferPatch(new Date('2026-10-05T12:00:00Z')) })
  assert.equal(pool.phase, 'pool')
  assert.equal(pool.netCents, Math.round(6800 * 0.7))
  assert.match(pool.subtext, /70%/)
  const scheduled = ladderOfferNet({ fareCents: 6800, status: 'scheduled', metadata: scheduledOfferPatch() })
  assert.equal(scheduled.netCents, Math.round(6800 * 0.75))
  assert.match(scheduled.subtext, /75%/)
})

test('a missed exclusive card stays visible through the two-minute pool', () => {
  const expires = '2026-10-05T12:00:15.000Z'
  const trip = {
    status: 'offered',
    offer_expires_at: expires,
    metadata: { kind: 'driver_request', offer_phase: 'exclusive', offer_driver_id: 'driver-1' },
  }
  const until = ladderCardVisibleUntilMs(trip)
  assert.equal(until, Date.parse(expires) + 120_000)
  assert.equal(exclusiveSecondsLeft({ offerExpiresAt: expires, offerPhase: 'exclusive' }, Date.parse('2026-10-05T12:00:00.000Z')), 15)
  assert.equal(exclusiveSecondsLeft({ offerExpiresAt: expires, offerPhase: 'pool' }, Date.parse('2026-10-05T12:00:00.000Z')), null)
})

test('hourly rate uses the offered net and the drive to pickup', () => {
  const card = {
    fareCents: 3600,
    status: 'searching',
    metadata: exclusiveOfferPatch(),
    pickupLat: 34.69,
    pickupLng: -82.84,
    dropoffLat: 34.70,
    dropoffLng: -82.84,
    routeDurationS: 600,
  }
  const near = offerHourly(card, { lat: 34.6901, lng: -82.8401 })
  const far = offerHourly(card, { lat: 34.85, lng: -82.4 })
  assert.ok(near.hourlyCents > far.hourlyCents)
  assert.match(formatHourlyRate(near.hourlyCents), /^\$\d+\/hr$/)
  const miles = pickupMiles(card, { lat: 34.6901, lng: -82.8401 })
  assert.ok(miles != null && miles < 1)
})

test('ride alert modes are per tier and default to chime plus vibration', () => {
  const prefs = normalizeRideAlerts({ standard: 'silent', wait: 'vibrate', comfort: 'nope' })
  assert.equal(prefs.standard, 'silent')
  assert.equal(prefs.wait, 'vibrate')
  assert.equal(prefs.comfort, 'chime_vibrate')
  assert.equal(prefs.carpool, 'chime_vibrate')
  assert.equal(rideAlertTier('carpool'), 'carpool')
  assert.deepEqual(alertPlayback('chime'), { sound: true, vibrate: false })
  assert.deepEqual(alertPlayback('vibrate'), { sound: false, vibrate: true })
  assert.deepEqual(alertPlayback('silent'), { sound: false, vibrate: false })
})
