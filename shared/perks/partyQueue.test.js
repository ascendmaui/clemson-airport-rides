import assert from 'node:assert/strict'
import test from 'node:test'
import { inPartyZone, partyQueueBoost, partyWindowOpen } from './partyQueue.js'

const cfg = { lat: 34.6834, lng: -82.8374, radiusKm: 0.6, startHour: 22, endHour: 3, days: [4, 5, 6], boost: 2 }
const collegeAve = { lat: 34.6838, lng: -82.8370 }

test('window: Thu-Sat 10pm-3am ET, after-midnight hours belong to the previous night', () => {
  assert.ok(partyWindowOpen(cfg, new Date('2026-10-17T03:30:00Z')))  // Fri 11:30 PM EDT
  assert.ok(partyWindowOpen(cfg, new Date('2026-10-18T06:30:00Z')))  // Sun 2:30 AM EDT -> Sat night
  assert.ok(!partyWindowOpen(cfg, new Date('2026-10-19T06:30:00Z'))) // Mon 2:30 AM -> Sun night
  assert.ok(!partyWindowOpen(cfg, new Date('2026-10-17T20:00:00Z'))) // Sat 4 PM
  assert.ok(!partyWindowOpen({ ...cfg, enabled: false }, new Date('2026-10-17T03:30:00Z')))
})

test('zone radius', () => {
  assert.ok(inPartyZone(collegeAve, cfg))
  assert.ok(!inPartyZone({ lat: 34.70, lng: -82.84 }, cfg))
})

test('opted-in drivers are boosted FIFO; others are not', () => {
  const at = new Date('2026-10-17T03:30:00Z')
  const fn = partyQueueBoost(collegeAve, [{ driverId: 'late', joinedAt: '2026-10-17T02:00:00Z' }, { driverId: 'early', joinedAt: '2026-10-17T01:00:00Z' }], cfg, at)
  assert.ok(fn({ id: 'early' }) > fn({ id: 'late' }))
  assert.ok(fn({ id: 'late' }) >= 2)
  assert.equal(fn({ id: 'other' }), 0)
  assert.equal(partyQueueBoost(collegeAve, [], cfg, new Date('2026-10-17T20:00:00Z')), null)
  assert.equal(partyQueueBoost({ lat: 34.70, lng: -82.84 }, [], cfg, at), null)
})
