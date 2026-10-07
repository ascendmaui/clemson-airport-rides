import assert from 'node:assert/strict'
import test from 'node:test'
import { fareAuthorizationCents } from './fareAuthorization.js'
import {
  BOOST_DRIVER_SHARE_BPS,
  BOOST_MAX_CENTS,
  BOOST_PRESETS_CENTS,
  boostNudge,
  captureCentsWithBoost,
  clampBoostCents,
  compareBoostedFirst,
  driverBoostShareCents,
  driverPayoutWithBoost,
  holdQuoteCents,
  parseBoostBump,
  parseBoostCents,
  parseBoostDollars,
  platformBoostShareCents,
  readBoostCents,
} from './scheduledBoost.js'

test('hold is estimated fare plus buffer plus the full boost', () => {
  const plain = fareAuthorizationCents(10000)
  const held = holdQuoteCents(10000, 1500)
  assert.equal(held.estimatedFareCents, 10000)
  assert.equal(held.bufferCents, plain.bufferCents)
  assert.equal(held.bufferCents, 2000)
  assert.equal(held.boostCents, 1500)
  assert.equal(held.authorizationCents, 10000 + 2000 + 1500)
  assert.equal(captureCentsWithBoost(9800, 1500), 11300)
})

test('a zero estimate still authorizes the boost and a small fare keeps the $2 buffer', () => {
  assert.deepEqual(holdQuoteCents(0, 500), {
    estimatedFareCents: 0,
    bufferCents: 0,
    boostCents: 500,
    authorizationCents: 500,
  })
  const small = holdQuoteCents(500, 1000)
  assert.equal(small.bufferCents, 200)
  assert.equal(small.authorizationCents, 500 + 200 + 1000)
  assert.equal(holdQuoteCents(10000, 0).authorizationCents, fareAuthorizationCents(10000).authorizationCents)
})

test('boost cap rejects amounts over $100 and negatives, and presets stay inside it', () => {
  assert.equal(BOOST_MAX_CENTS, 10000)
  assert.deepEqual([...BOOST_PRESETS_CENTS], [500, 1000, 1500, 2000])
  assert.equal(parseBoostCents(10000).ok, true)
  assert.equal(parseBoostCents(10001).ok, false)
  assert.match(parseBoostCents(10001).error, /\$100/)
  assert.equal(parseBoostCents(-1).ok, false)
  assert.equal(parseBoostCents('nope').ok, false)
  assert.equal(parseBoostCents('').cents, 0)
  assert.equal(parseBoostDollars('10.50').cents, 1050)
  assert.equal(parseBoostDollars('$100').cents, 10000)
  assert.equal(parseBoostDollars('100.01').ok, false)
  assert.equal(clampBoostCents(25000), 10000)
  assert.equal(parseBoostBump(2000, 1500).cents, 2000)
  assert.equal(parseBoostBump(1500, 1500).ok, false)
  assert.equal(parseBoostBump(20000, 500).ok, false)
})

test('driver payout adds 100% of the boost and the platform fee does not take a cut', () => {
  assert.equal(BOOST_DRIVER_SHARE_BPS, 10000)
  assert.equal(driverBoostShareCents(1500), 1500)
  assert.equal(platformBoostShareCents(1500), 0)
  assert.equal(driverPayoutWithBoost(7500, 1500), 9000)
  assert.equal(driverPayoutWithBoost(0, 2000), 2000)
  const carpoolNet = 3600
  assert.equal(driverPayoutWithBoost(carpoolNet, 1000), 4600)
})

test('boost reads the column, then metadata, and ignores the post-trip tip', () => {
  assert.equal(readBoostCents({ boost_cents: 500, metadata: { boost_cents: 900, tip_cents: 300 } }), 500)
  assert.equal(readBoostCents({ metadata: { boost_cents: 900, tip_cents: 300 }, tip_cents: 400 }), 900)
  assert.equal(readBoostCents({ tip_cents: 400 }), 0)
  assert.equal(readBoostCents({ boostCents: 250 }), 250)
})

test('boosted scheduled rides sort ahead of earlier unboosted pickups', () => {
  const rows = [
    { id: 'early', pickup_at: '2026-10-08T14:00:00.000Z', metadata: { boost_cents: 0 } },
    { id: 'later', pickup_at: '2026-10-08T18:00:00.000Z', metadata: { boost_cents: 2000 } },
    { id: 'mid', pickup_at: '2026-10-08T16:00:00.000Z', boost_cents: 500 },
  ]
  const sorted = [...rows].sort(compareBoostedFirst).map((row) => row.id)
  assert.deepEqual(sorted, ['later', 'mid', 'early'])
})

test('nudge appears only while the ride is unaccepted inside the lead window', () => {
  const pickup = '2026-10-08T18:00:00.000Z'
  const soon = new Date('2026-10-08T16:30:00.000Z')
  const early = new Date('2026-10-08T12:00:00.000Z')
  const open = { status: 'scheduled', driver_id: null, pickup_at: pickup, metadata: {} }
  assert.match(boostNudge(open, soon).body, /Add a boost/)
  assert.equal(boostNudge(open, early), null)
  assert.equal(boostNudge({ ...open, driver_id: 'drv' }, soon), null)
  assert.equal(boostNudge({ ...open, status: 'accepted' }, soon), null)
  assert.match(boostNudge({ ...open, metadata: { boost_cents: 500 } }, soon).body, /Raise the boost/)
  assert.match(boostNudge({ ...open, status: 'searching', metadata: { kind: 'carpool', boost_cents: 0 } }, soon).body, /Add a boost/)
})
