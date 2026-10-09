import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { loadDriverDesk } from '../packages/rides-native/driverDesk.js'
import { expireStaleLiveOffers, shouldExpireStaleLiveOffer } from './staleLiveOffer.js'
import { isStaleLiveOffer, STALE_LIVE_OFFER_TTL_MS } from '../shared/staleLiveOffer.js'
import { createMatchingSupabase, seedMatchingScenario } from '../tests/fixtures/matchingE2E.js'

const now = new Date('2026-10-05T18:00:00.000Z')
const old = new Date(now.getTime() - STALE_LIVE_OFFER_TTL_MS - 60_000).toISOString()
const fresh = new Date(now.getTime() - 5 * 60 * 1000).toISOString()

function stadium(patch = {}) {
  return {
    id: 'stadium-gsp',
    status: 'offered',
    driver_id: null,
    rider_id: 'rider-1',
    pickup_label: 'Memorial Stadium',
    dropoff_label: 'GSP Airport',
    fare_cents: 6882,
    deposit_cents: 0,
    requested_at: old,
    created_at: old,
    offer_expires_at: null,
    pickup_at: null,
    scheduled_for: null,
    metadata: {},
    ...patch,
  }
}

test('an unassigned offered trip older than 15 minutes is not a live offer', () => {
  assert.equal(isStaleLiveOffer(stadium(), now), true)
  assert.equal(shouldExpireStaleLiveOffer(stadium(), now), true)
  assert.equal(isStaleLiveOffer(stadium({ requested_at: fresh, created_at: fresh }), now), false)
  assert.equal(isStaleLiveOffer(stadium({ driver_id: 'driver-1' }), now), false)
  assert.equal(isStaleLiveOffer(stadium({ status: 'searching' }), now), false)
  assert.equal(isStaleLiveOffer(stadium({ status: 'accepted', driver_id: 'driver-1' }), now), false)
})

test('a past offer_expires_at expires even inside the age window', () => {
  const past = new Date(now.getTime() - 1000).toISOString()
  const future = new Date(now.getTime() + 30_000).toISOString()
  const young = stadium({ requested_at: fresh, created_at: fresh, offer_expires_at: past })
  assert.equal(isStaleLiveOffer(young, now), true)
  assert.equal(isStaleLiveOffer(stadium({ offer_expires_at: future, requested_at: old }), now), false)
})

test('rebroadcast, unpaid holds, future pickups, and payment holds are not canceled', () => {
  const targeted = stadium({
    offer_expires_at: new Date(now.getTime() - 1000).toISOString(),
    metadata: { kind: 'driver_request', offer_driver_id: 'driver-1' },
  })
  assert.equal(isStaleLiveOffer(targeted, now), false)
  assert.equal(isStaleLiveOffer(targeted, new Date(now.getTime() + 120_000)), true)
  assert.equal(shouldExpireStaleLiveOffer(targeted, now), false)
  const pooled = stadium({
    offer_expires_at: new Date(now.getTime() - 1000).toISOString(),
    metadata: { kind: 'driver_request', offer_phase: 'pool' },
  })
  assert.equal(isStaleLiveOffer(pooled, now), true)
  assert.equal(shouldExpireStaleLiveOffer(stadium({
    deposit_cents: 1700,
    rider_note: 'airport',
    metadata: { purpose: 'airport' },
  }), now), false)
  assert.equal(shouldExpireStaleLiveOffer(stadium({
    pickup_at: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
  }), now), false)
  assert.equal(shouldExpireStaleLiveOffer(stadium({
    metadata: { payment_hold: { status: 'payment_required' } },
  }), now), false)
  assert.equal(shouldExpireStaleLiveOffer(stadium({
    deposit_cents: 1720,
    metadata: { purpose: 'airport', checkout_deposit: { session_id: 'cs_paid' }, fare_paid_cents: 1720 },
  }), now), true)
})

test('the sweep cancels the stadium zombie and leaves a fresh offer and an assigned trip', async () => {
  const freshTrip = stadium({ id: 'fresh', requested_at: fresh, created_at: fresh })
  const assigned = stadium({ id: 'assigned', driver_id: 'driver-1' })
  const supabase = createMatchingSupabase({
    trips: [stadium(), freshTrip, assigned],
    trip_events: [],
  })
  const dry = await expireStaleLiveOffers(supabase, { now, dryRun: true })
  assert.equal(dry.wouldExpire, 1)
  assert.equal(supabase._tables.trips[0].status, 'offered')
  const result = await expireStaleLiveOffers(supabase, { now })
  assert.equal(result.expired, 1)
  assert.equal(result.errors, 0)
  assert.equal(supabase._tables.trips[0].status, 'canceled')
  assert.equal(supabase._tables.trips[0].metadata.offer_expired_reason, 'stale_live_offer')
  assert.equal(supabase._tables.trips[1].status, 'offered')
  assert.equal(supabase._tables.trips[2].status, 'offered')
  assert.equal(supabase._tables.trip_events[0].payload.reason, 'stale_live_offer')
  const again = await expireStaleLiveOffers(supabase, { now })
  assert.equal(again.expired, 0)
})

test('a concurrent accept keeps the trip and a past deadline cancels a non-targeted offer', async () => {
  const racing = createMatchingSupabase({ trips: [stadium()], trip_events: [] })
  racing._tables.trips[0].driver_id = 'driver-9'
  racing._tables.trips[0].status = 'accepted'
  const lost = await expireStaleLiveOffers(racing, { now })
  assert.equal(lost.scanned, 0)

  const deadline = stadium({
    id: 'deadline',
    requested_at: fresh,
    created_at: fresh,
    offer_expires_at: new Date(now.getTime() - 1000).toISOString(),
    metadata: { kind: 'airport', purpose: 'airport' },
    deposit_cents: 0,
  })
  const supabase = createMatchingSupabase({ trips: [deadline], trip_events: [] })
  assert.equal((await expireStaleLiveOffers(supabase, { now })).expired, 1)
  assert.equal(supabase._tables.trips[0].status, 'canceled')
})

test('online drivers do not see a stale offered Memorial Stadium trip', async () => {
  const wall = Date.now()
  const staleAt = new Date(wall - STALE_LIVE_OFFER_TTL_MS - 60_000).toISOString()
  const freshAt = new Date(wall - 5 * 60 * 1000).toISOString()
  const { supabase } = seedMatchingScenario({
    trip: stadium({ fare_cents: 6882, requested_at: staleAt, created_at: staleAt }),
  })
  const hidden = await loadDriverDesk(supabase, 'driver-1')
  assert.deepEqual(hidden.offers, [])
  supabase._tables.trips[0].requested_at = freshAt
  supabase._tables.trips[0].created_at = freshAt
  const visible = await loadDriverDesk(supabase, 'driver-1')
  assert.equal(visible.offers[0].id, 'stadium-gsp')
  assert.equal(visible.offers[0].status, 'offered')
})

test('the migration cancels stale offered rows and leaves rebroadcast targets', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261005180000_expire_stale_live_offers.sql', import.meta.url), 'utf8')
  assert.match(sql, /status = 'offered'::public.trip_status/)
  assert.match(sql, /driver_id is null/)
  assert.match(sql, /interval '15 minutes'/)
  assert.match(sql, /offer_expires_at <= now\(\)/)
  assert.match(sql, /driver_request/)
  assert.match(sql, /payment_required/)
  assert.match(sql, /checkout_deposit/)
  assert.match(sql, /create index if not exists trips_stale_offered_idx/)
})
