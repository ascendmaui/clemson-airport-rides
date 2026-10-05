import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { acceptTrip } from '../packages/rides-native/driverDesk.js'
import { visibleOffer } from '../src/lib/driverShift.js'
import { rebroadcastOwnsOffer } from '../shared/staleLiveOffer.js'
import { cancelSearchingTrip, seedMatchingScenario } from '../tests/fixtures/matchingE2E.js'
import { rebroadcastMissedOffers } from './matchingRebroadcast.js'
import { shouldExpireStaleLiveOffer } from './staleLiveOffer.js'
import {
  DECLINE_NEXT_DRIVER_MESSAGE,
  DECLINE_OPEN_POOL_MESSAGE,
  DECLINE_STILL_SEARCHING_MESSAGE,
  OFFLINE_WHILE_OFFERED_MESSAGE,
  RIDER_DECLINE_NEXT_MESSAGE,
  RIDER_DECLINE_OPEN_MESSAGE,
  SEARCHING_CANCEL_ACCEPT_MESSAGE,
  activeOfferCard,
  declinePassMessage,
  declineRebroadcastFlags,
  offlineWhileOfferedMessage,
  riderDeclineRebroadcastMessage,
  searchingCancelBlocksLaterAccept,
  searchingCancelOfferMessage,
} from './matchingEdge.js'
import {
  OFFLINE_WHILE_OFFERED_MESSAGE as reexportedOfflineMessage,
} from '../packages/rides-native/matchingMessages.js'

const now = new Date('2026-10-04T12:01:00.000Z')

function targetedTrip(overrides = {}) {
  return {
    id: 'trip-searching-1',
    rider_id: 'rider-1',
    driver_id: null,
    status: 'searching',
    tier: 'standard',
    deposit_cents: 0,
    metadata: {
      kind: 'driver_request',
      match: 'auto',
      offer_driver_id: 'driver-1',
      auto_assign_queue: ['driver-1', 'driver-2', 'driver-3'],
      preserved: 'yes',
    },
    ...overrides,
  }
}

test('rider cancel while searching blocks a later accept', async () => {
  const searching = targetedTrip()
  const offered = targetedTrip({ status: 'offered' })
  assert.equal(searchingCancelBlocksLaterAccept(searching), false)
  assert.equal(searchingCancelBlocksLaterAccept(offered), false)
  assert.equal(searchingCancelBlocksLaterAccept(null), true)
  assert.equal(searchingCancelBlocksLaterAccept({ status: 'accepted', driver_id: null }), false)
  assert.equal(searchingCancelBlocksLaterAccept({ status: 'canceled', driver_id: 'driver-1' }), false)

  for (const status of ['canceled', 'cancelled']) {
    assert.equal(searchingCancelBlocksLaterAccept({ status, driver_id: null }), true)
    assert.equal(searchingCancelBlocksLaterAccept({ status, driver_id: '' }), true)
  }

  const { supabase, trip, riderId, drivers } = seedMatchingScenario({
    trip: {
      deposit_cents: 0,
      metadata: { kind: 'driver_request', offer_driver_id: 'driver-1' },
    },
  })
  assert.equal(searchingCancelBlocksLaterAccept(trip), false)
  const canceled = await cancelSearchingTrip(supabase, trip.id, riderId)
  const stored = supabase._tables.trips[0]
  assert.equal(canceled.status, 'canceled')
  assert.equal(stored.driver_id, null)
  assert.equal(searchingCancelBlocksLaterAccept(stored), true)

  await assert.rejects(
    () => acceptTrip(supabase, trip, drivers[0].id),
    /That ride is no longer available/,
  )
  assert.equal(stored.status, 'canceled')
  assert.equal(stored.driver_id, null)
  assert.equal(supabase._tables.trip_events.filter((event) => event.kind === 'accepted').length, 0)
  assert.equal(supabase._tables.trip_events.filter((event) => event.kind === 'canceled').length, 1)
})

test('driver decline stamps rebroadcast path flags and the sweep skips that driver', async () => {
  for (const status of ['searching', 'offered']) {
    const trip = targetedTrip({ status })
    const flags = declineRebroadcastFlags(trip, { driverId: 'driver-1', nextDriverId: 'driver-2', now })
    assert.equal(flags.applied, true)
    assert.equal(flags.rebroadcast, true)
    assert.equal(flags.status, 'searching')
    assert.equal(flags.driver_id, null)
    assert.equal(flags.metadata.offer_driver_id, 'driver-2')
    assert.deepEqual(flags.metadata.offer_tried_driver_ids, ['driver-1'])
    assert.deepEqual(flags.metadata.offer_passed_driver_ids, ['driver-1'])
    assert.equal(flags.metadata.offer_release_reason, 'driver_decline')
    assert.equal(flags.metadata.offer_rebroadcast_reason, 'driver_decline')
    assert.equal(flags.metadata.offer_released_at, now.toISOString())
    assert.equal(flags.metadata.match, 'auto')
    assert.equal(flags.metadata.preserved, 'yes')
    assert.equal(trip.metadata.offer_driver_id, 'driver-1')
    assert.equal(trip.status, status)

    const patched = { ...trip, status: flags.status, driver_id: flags.driver_id, metadata: flags.metadata }
    assert.equal(rebroadcastOwnsOffer(patched), true)
    assert.equal(shouldExpireStaleLiveOffer(patched, now), false)
  }

  const exhausted = declineRebroadcastFlags(targetedTrip(), {
    driverId: 'driver-1',
    nextDriverId: null,
    now,
  })
  assert.equal(exhausted.metadata.offer_driver_id, null)
  assert.equal(exhausted.metadata.match, 'open')
  assert.equal(exhausted.status, 'searching')
  assert.equal(shouldExpireStaleLiveOffer({
    ...targetedTrip(),
    status: exhausted.status,
    driver_id: exhausted.driver_id,
    metadata: exhausted.metadata,
  }, now), false)

  const skippedNext = declineRebroadcastFlags(targetedTrip(), {
    driverId: 'driver-1',
    nextDriverId: 'rider-1',
    now,
  })
  assert.equal(skippedNext.metadata.offer_driver_id, null)
  assert.equal(skippedNext.metadata.match, 'open')

  const alreadyTried = targetedTrip()
  alreadyTried.metadata = { ...alreadyTried.metadata, offer_tried_driver_ids: ['driver-2'] }
  const tried = declineRebroadcastFlags(alreadyTried, { driverId: 'driver-1', nextDriverId: 'driver-2', now })
  assert.equal(tried.metadata.offer_driver_id, null)
  assert.deepEqual(tried.metadata.offer_tried_driver_ids, ['driver-2', 'driver-1'])

  const stale = targetedTrip()
  const snapshot = structuredClone(stale)
  const ignored = declineRebroadcastFlags(stale, { driverId: 'driver-2', nextDriverId: 'driver-3', now })
  assert.equal(ignored.applied, false)
  assert.equal(ignored.rebroadcast, false)
  assert.deepEqual(stale, snapshot)

  for (const patch of [
    { pickup_at: now.toISOString() },
    { scheduled_for: now.toISOString() },
    { deposit_cents: 1500 },
    { status: 'accepted' },
    { driver_id: 'driver-1' },
    { metadata: { kind: 'airport', offer_driver_id: 'driver-1' } },
    { metadata: { offer_driver_id: 'driver-1' } },
  ]) {
    const blocked = declineRebroadcastFlags(targetedTrip(patch), { driverId: 'driver-1', nextDriverId: 'driver-2', now })
    assert.equal(blocked.applied, false)
  }

  const { supabase } = seedMatchingScenario({
    drivers: [
      { id: 'driver-1', approved: true, online: true, lat: 34.68, lng: -82.84 },
      { id: 'driver-2', approved: true, online: true, lat: 34.68, lng: -82.83 },
      { id: 'driver-3', approved: true, online: true, lat: 34.68, lng: -82.82 },
    ],
    trip: {
      offer_expires_at: now.toISOString(),
      deposit_cents: 0,
      metadata: targetedTrip().metadata,
    },
  })
  const live = declineRebroadcastFlags(supabase._tables.trips[0], {
    driverId: 'driver-1',
    nextDriverId: 'driver-2',
    now,
  })
  supabase._tables.trips[0].status = live.status
  supabase._tables.trips[0].driver_id = live.driver_id
  supabase._tables.trips[0].metadata = live.metadata
  const swept = await rebroadcastMissedOffers(supabase, { now })
  assert.equal(swept.advanced, 1)
  const stored = supabase._tables.trips[0]
  assert.equal(stored.status, 'searching')
  assert.equal(stored.driver_id, null)
  assert.equal(stored.metadata.offer_driver_id, 'driver-3')
  assert.ok(stored.metadata.offer_tried_driver_ids.includes('driver-1'))
  assert.ok(stored.metadata.offer_tried_driver_ids.includes('driver-2'))
  assert.equal(stored.metadata.offer_rebroadcast_reason, 'no_accept_timeout')
  assert.equal(stored.metadata.preserved, 'yes')
})

test('an offline driver cannot keep an active offer card', () => {
  const offered = { id: 'offer-9', status: 'offered' }
  const searching = { id: 'offer-8', status: 'searching' }
  assert.equal(activeOfferCard({ online: true, card: offered }), offered)
  assert.equal(activeOfferCard({ online: true, card: searching }), searching)
  assert.equal(activeOfferCard({ online: false, card: offered }), null)
  assert.equal(activeOfferCard({ online: null, card: offered }), null)
  assert.equal(activeOfferCard({ online: 'true', card: searching }), null)
  assert.equal(activeOfferCard({ online: true, card: { id: 'trip-1', status: 'accepted' } }), null)
  assert.equal(activeOfferCard({ online: true, card: null }), null)
  assert.equal(offered.status, 'offered')

  assert.equal(visibleOffer({ onShift: false, offer: offered, activeTrip: null }), null)
  assert.equal(offlineWhileOfferedMessage({ online: false, card: offered }), OFFLINE_WHILE_OFFERED_MESSAGE)
  assert.equal(offlineWhileOfferedMessage({ online: false, card: searching }), OFFLINE_WHILE_OFFERED_MESSAGE)
  assert.equal(offlineWhileOfferedMessage({ online: true, card: offered }), null)
  assert.equal(offlineWhileOfferedMessage({ online: false, card: { id: 'trip-1', status: 'accepted' } }), null)
  assert.equal(offlineWhileOfferedMessage({ online: false, card: null }), null)
})

test('the helper file does not implement stale-offer expiry', () => {
  const source = readFileSync(new URL('./matchingEdge.js', import.meta.url), 'utf8')
  const doc = readFileSync(new URL('../docs/MATCHING_EDGE_CASES.md', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /expireStale|expire_stale|expire-stale/i)
  assert.match(doc, /searchingCancelBlocksLaterAccept/)
  assert.match(doc, /declineRebroadcastFlags/)
  assert.match(doc, /activeOfferCard/)
  assert.match(doc, /offlineWhileOfferedMessage/)
  assert.match(doc, /searchingCancelOfferMessage/)
  assert.match(doc, /declinePassMessage/)
  assert.match(doc, /riderDeclineRebroadcastMessage/)
  assert.match(doc, /do not expire stale offers/)
})

test('cancel, decline, and offline messages match the edge the screens show', () => {
  assert.equal(reexportedOfflineMessage, OFFLINE_WHILE_OFFERED_MESSAGE)
  assert.equal(searchingCancelOfferMessage({ status: 'canceled', driver_id: null }), SEARCHING_CANCEL_ACCEPT_MESSAGE)
  assert.equal(searchingCancelOfferMessage({ status: 'cancelled', driver_id: '' }), SEARCHING_CANCEL_ACCEPT_MESSAGE)
  assert.equal(searchingCancelOfferMessage({ status: 'canceled', driver_id: 'driver-1' }), null)
  assert.equal(searchingCancelOfferMessage(targetedTrip()), null)

  assert.equal(declinePassMessage({ offerDriverId: 'driver-2' }), DECLINE_NEXT_DRIVER_MESSAGE)
  assert.equal(declinePassMessage({ nextDriverId: 'driver-2', released: true }), DECLINE_NEXT_DRIVER_MESSAGE)
  assert.equal(declinePassMessage({ released: true }), DECLINE_OPEN_POOL_MESSAGE)
  assert.equal(declinePassMessage({ keptSearching: true }), DECLINE_STILL_SEARCHING_MESSAGE)
  assert.equal(declinePassMessage({ unchanged: true, released: true }), null)
  assert.equal(declinePassMessage(null), null)

  const passed = targetedTrip()
  passed.metadata = {
    ...passed.metadata,
    offer_driver_id: 'driver-2',
    offer_rebroadcast_reason: 'driver_decline',
  }
  assert.equal(riderDeclineRebroadcastMessage(passed), RIDER_DECLINE_NEXT_MESSAGE)
  const opened = targetedTrip()
  opened.metadata = {
    ...opened.metadata,
    offer_driver_id: null,
    offer_release_reason: 'driver_decline',
  }
  assert.equal(riderDeclineRebroadcastMessage(opened), RIDER_DECLINE_OPEN_MESSAGE)
  assert.equal(riderDeclineRebroadcastMessage({ ...opened, driver_id: 'driver-9' }), null)
  assert.equal(riderDeclineRebroadcastMessage({ ...opened, status: 'accepted' }), null)

  const home = readFileSync(new URL('../src/screens/DriverHome.jsx', import.meta.url), 'utf8')
  const requested = readFileSync(new URL('../src/screens/Requested.jsx', import.meta.url), 'utf8')
  const detail = readFileSync(new URL('../packages/rides-native/tripTags.js', import.meta.url), 'utf8')
  const nativeHome = readFileSync(new URL('../apps/driver/app/(tabs)/index.tsx', import.meta.url), 'utf8')
  assert.match(home, /offlineWhileOfferedMessage/)
  assert.match(home, /searchingCancelOfferMessage/)
  assert.match(home, /declinePassMessage/)
  assert.match(home, /driverStatusDetail\(offer\.status\)/)
  assert.match(requested, /riderDeclineRebroadcastMessage/)
  assert.match(detail, /next driver/)
  assert.match(detail, /open pool/)
  assert.match(nativeHome, /offlineWhileOfferedMessage/)
  assert.match(nativeHome, /declinePassMessage/)
})
