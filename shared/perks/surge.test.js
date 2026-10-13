import assert from 'node:assert/strict'
import test from 'node:test'
import { driverSurgeView, haversineKm, surgeAwards, surgeZones, zoneBoost } from './surge.js'

const stadium = { lat: 34.6788, lng: -82.8432 }
const events = [{ id: 'e1', title: 'Clemson vs FSU', pickup_zone_label: 'Memorial Stadium', pickup_lat: stadium.lat, pickup_lng: stadium.lng, starts_at: '2026-10-17T16:00:00Z', ends_at: '2026-10-17T23:00:00Z', active: true }]
const cfg = { startsAt: '2026-10-01T00:00:00Z', radiusKm: 1.5, driverBonusCents: 300, zoneBoost: 1, leadHours: 36, zones: [{ id: 'bar', title: 'Late night', label: 'College Ave', lat: 34.6834, lng: -82.8374, startsAt: '2026-10-18T02:00:00Z', endsAt: '2026-10-18T06:00:00Z' }] }

test('zones merge game_day_events and config zones', () => {
  const zones = surgeZones(events, cfg)
  assert.deepEqual(zones.map((z) => z.id), ['event:e1', 'config:bar'])
  assert.ok(haversineKm(stadium, { lat: 34.6834, lng: -82.8374 }) < 1)
})

test('Home view lists live and upcoming zones within the lead window', () => {
  const zones = surgeZones(events, cfg)
  const v = driverSurgeView(zones, cfg, new Date('2026-10-17T18:00:00Z'))
  assert.deepEqual(v.zones.map((z) => [z.id, z.live]), [['event:e1', true], ['config:bar', false]])
  assert.equal(driverSurgeView(zones, cfg, new Date('2026-10-15T00:00:00Z')).zones.length, 0)
  assert.equal(driverSurgeView(zones, { ...cfg, enabled: false }).enabled, false)
})

test('matching boost only when pickup is in a live zone and driver is nearby', () => {
  const zones = surgeZones(events, cfg)
  const live = new Date('2026-10-17T18:00:00Z')
  const near = { lat: 34.68, lng: -82.84 }
  const far = { lat: 34.75, lng: -82.9 }
  assert.equal(zoneBoost(near, stadium, zones, cfg, live), 1)
  assert.equal(zoneBoost(far, stadium, zones, cfg, live), 0)
  assert.equal(zoneBoost(near, stadium, zones, cfg, new Date('2026-10-17T10:00:00Z')), 0)
  assert.equal(zoneBoost(near, { lat: 34.9, lng: -82.5 }, zones, cfg, live), 0)
})

test('driver bonus awards for zone pickups during the event, after startsAt', () => {
  const zones = surgeZones(events, cfg)
  const trips = [
    { id: 't1', status: 'completed', pickup_lat: 34.679, pickup_lng: -82.843, accepted_at: '2026-10-17T20:00:00Z' },
    { id: 't2', status: 'completed', pickup_lat: 34.679, pickup_lng: -82.843, accepted_at: '2026-10-17T12:00:00Z' },
    { id: 't3', status: 'completed', pickup_lat: 34.80, pickup_lng: -82.843, accepted_at: '2026-10-17T20:00:00Z' },
  ]
  assert.deepEqual(surgeAwards(trips, zones, cfg).map((a) => [a.ref, a.amountCents]), [['trip:t1', 300]])
  assert.equal(surgeAwards(trips, zones, { ...cfg, startsAt: undefined }).length, 0)
})
