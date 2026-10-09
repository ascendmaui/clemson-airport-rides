import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { buildPayoutRecord } from '../server/payouts.js'
import { driverTripEarnings, driverTripNetCents, payoutStatusLine, tigerHeatPayoutCents } from '../shared/driverTripEarnings.js'
import { fareCollection, toDriverCard } from '../packages/rides-native/tripTags.js'
import {
  backInQueueCopy,
  normalizeRatingTags,
  ratingTagOptions,
  toggleRatingTag,
  tripEndSummary,
} from '../packages/rides-native/tripEndSummary.js'
import { cleanRatingTags, submitPartyRating } from '../packages/rides-native/partyProfile.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const DRIVER = 'driver-1'
const base = { id: 'trip-1', rider_id: 'rider-1', driver_id: DRIVER, status: 'completed', fare_cents: 2000, metadata: {} }

const cases = {
  plain: base,
  boost: { ...base, boost_cents: 500, metadata: { boost_cents: 500 } },
  wait: { ...base, wait_fee_cents: 400, driver_wait_earnings_cents: 320 },
  lockedPool: { ...base, metadata: { offer_phase: 'pool', offer_share_bps: 7000, driver_payout_cents: 1400 } },
  backupPromoted: {
    ...base,
    backup_bonus_cents: 300,
    metadata: { backup_queue: { enabled: true, bonusCents: 300, promotedFromBackup: true, confirmState: 'confirmed' } },
  },
  tigerHeat: {
    ...base,
    metadata: { tiger_heat: { settled: true, driverEarningsCents: 1900, bonusCents: 300, platformFundedCents: 300 } },
  },
  everything: {
    ...base,
    boost_cents: 1000,
    wait_fee_cents: 200,
    driver_wait_earnings_cents: 160,
    tip_cents: 300,
    metadata: { boost_cents: 1000, driver_payout_cents: 1600 },
  },
  inProgress: { ...base, status: 'in_progress', boost_cents: 500, driver_wait_earnings_cents: 160 },
}

test('one net: payout queue, trip header, fare panel, and trip-end summary agree', () => {
  for (const [name, trip] of Object.entries(cases)) {
    const expected = trip.status === 'completed' ? buildPayoutRecord(trip).amountCents : driverTripEarnings(trip).netCents
    const card = toDriverCard(trip, { driverId: DRIVER })
    assert.equal(card.driverNetCents, expected, `${name}: header`)
    assert.equal(fareCollection(card).totalNetCents, expected, `${name}: fare panel`)
    if (trip.status === 'completed') assert.equal(tripEndSummary(card).net.cents, expected, `${name}: summary`)
  }
})

test('the old two-net bug: a boosted trip no longer shows a lower fare-panel net', () => {
  const card = toDriverCard(cases.boost, { driverId: DRIVER })
  const fare = fareCollection(card)
  assert.equal(fare.driverNetCents, 1600)
  assert.ok(fare.boostNetCents > 0)
  assert.equal(fare.totalNetCents, card.driverNetCents)
  assert.equal(card.driverNetCents, 1600 + fare.boostNetCents)
})

test('wait share is only paid on completed trips and tips never enter the payout', () => {
  assert.equal(driverTripEarnings(cases.inProgress).waitCents, 0)
  assert.equal(driverTripEarnings(cases.wait).waitCents, 320)
  const all = driverTripEarnings(cases.everything)
  assert.equal(all.tipCents, 300)
  assert.equal(all.netCents, buildPayoutRecord(cases.everything).amountCents)
  assert.equal(all.netCents, 1600 + all.boostCents + 160)
})

test('a stored payout record wins once it exists', () => {
  const trip = { ...base, metadata: { payout: { amountCents: 1234, status: 'paid' } } }
  assert.equal(driverTripNetCents(trip), 1234)
  assert.equal(toDriverCard(trip, { driverId: DRIVER }).driverNetCents, 1234)
  assert.equal(payoutStatusLine(trip), 'Paid out to your bank account.')
  assert.equal(payoutStatusLine({ metadata: { payout: { status: 'failed' } } }), 'Payout did not go through yet. It retries automatically.')
})

test('cancellations: wait cancel pays the wait share, other cancels pay nothing', () => {
  assert.equal(driverTripEarnings({ ...base, status: 'cancelled_wait', driver_wait_earnings_cents: 500 }).netCents, 500)
  assert.equal(driverTripEarnings({ ...base, status: 'canceled' }).netCents, 0)
  assert.equal(buildPayoutRecord({ ...base, status: 'cancelled_wait', driver_wait_earnings_cents: 500 }).amountCents, 500)
})

test('offers keep showing the ladder share and boost, without trip earnings', () => {
  const card = toDriverCard({ id: 'o', status: 'offered', fare_cents: 2000, boost_cents: 500, metadata: { offer_phase: 'pool', offer_share_bps: 7000 } })
  assert.equal(card.earnings, null)
  const fare = fareCollection(card)
  assert.equal(fare.driverNetCents, 1400)
  assert.equal(fare.sharePercent, 70)
  assert.equal(fare.totalNetCents, card.driverNetCents)
})

test('tiger heat helper moved to shared and stays re-exported from payouts', async () => {
  const payouts = await import('../server/payouts.js')
  assert.equal(payouts.tigerHeatPayoutCents, tigerHeatPayoutCents)
  assert.equal(tigerHeatPayoutCents(cases.tigerHeat), 1900)
  assert.equal(tigerHeatPayoutCents({ metadata: { tiger_heat: { settled: false, driverEarningsCents: 1 } } }), null)
})

test('trip-end summary shows fare, wait fee, tip pending, and net', () => {
  const summary = tripEndSummary(toDriverCard(cases.wait, { driverId: DRIVER }))
  const labels = summary.lines.map((line) => line.label)
  assert.deepEqual(labels, ['Trip fare', 'Platform fee', 'Wait fee'])
  assert.equal(summary.lines[2].value, '+$3.20')
  assert.equal(summary.lines[2].note, 'Rider paid $4.00')
  assert.equal(summary.tip.value, 'Pending')
  assert.equal(summary.tip.pending, true)
  assert.equal(summary.net.label, 'Net earnings')
  assert.equal(summary.net.value, '$19.20')
  const tipped = tripEndSummary(toDriverCard(cases.everything, { driverId: DRIVER }))
  assert.equal(tipped.tip.value, '+$3.00')
  assert.equal(tipped.tip.pending, false)
  assert.match(tipped.accessibilityLabel, /Net earnings/)
})

test('rating tags follow the stars and are capped', () => {
  assert.ok(ratingTagOptions(5).includes('On time'))
  assert.ok(ratingTagOptions(2).includes('Wrong pickup spot'))
  assert.deepEqual(normalizeRatingTags(['On time', 'Late', 'On time'], 5), ['On time'])
  assert.deepEqual(toggleRatingTag(['On time'], 'On time', 5), [])
  assert.deepEqual(cleanRatingTags(['a', 'a', ' b ', '', 'c', 'd', 'e', 'f']), ['a', 'b', 'c', 'd', 'e'])
})

function fakeRatings({ failTags = false } = {}) {
  const inserts = []
  const trip = { id: 'trip-1', status: 'completed', rider_id: 'rider-1', driver_id: DRIVER }
  const supabase = {
    from(table) {
      const q = {
        select() { return q },
        eq() { return q },
        limit() { return q },
        maybeSingle: async () => (table === 'trips' ? { data: trip, error: null } : { data: null, error: null }),
        then: (resolve) => resolve({ data: [], error: null }),
        insert(row) {
          inserts.push(row)
          return {
            select: () => ({
              single: async () => (failTags && row.tags
                ? { data: null, error: { message: "Could not find the 'tags' column of 'ratings' in the schema cache" } }
                : { data: { id: 'r1', stars: row.stars }, error: null }),
            }),
          }
        },
      }
      return q
    },
  }
  return { supabase, inserts }
}

test('submitPartyRating saves tags, and falls back without them before the migration', async () => {
  const ok = fakeRatings()
  await submitPartyRating(ok.supabase, { tripId: 'trip-1', raterId: DRIVER, stars: 5, tags: ['On time'] })
  assert.deepEqual(ok.inserts.at(-1).tags, ['On time'])
  const none = fakeRatings()
  await submitPartyRating(none.supabase, { tripId: 'trip-1', raterId: DRIVER, stars: 5 })
  assert.equal('tags' in none.inserts.at(-1), false)
  const old = fakeRatings({ failTags: true })
  const saved = await submitPartyRating(old.supabase, { tripId: 'trip-1', raterId: DRIVER, stars: 4, tags: ['Clean'] })
  assert.equal(saved.id, 'r1')
  assert.equal(old.inserts.length, 2)
  assert.equal('tags' in old.inserts[1], false)
})

test('Back in queue copy', () => {
  assert.equal(backInQueueCopy(true).title, "You're online")
  assert.equal(backInQueueCopy(true).secondary, 'Go offline')
  assert.equal(backInQueueCopy(false).primary, 'Go online')
})

test('ratings.tags migration is additive and capped at five', async () => {
  const db = new PGlite()
  await db.exec(`create table public.ratings (id uuid primary key default gen_random_uuid(), trip_id uuid, rater_id uuid, ratee_id uuid, stars int, comment text, created_at timestamptz default now());`)
  const sql = read('../supabase/migrations/20261010100000_ratings_tags.sql')
  await db.exec(sql)
  await db.exec(sql)
  await db.exec(`insert into public.ratings (stars) values (5)`)
  const row = await db.query(`select tags from public.ratings`)
  assert.deepEqual(row.rows[0].tags, [])
  await db.exec(`insert into public.ratings (stars, tags) values (4, array['On time','Clean'])`)
  await assert.rejects(db.exec(`insert into public.ratings (stars, tags) values (4, array['a','b','c','d','e','f'])`))
  await db.close()
})

test('driver trip screen wires summary → tagged rating → Back in queue', () => {
  const trip = read('../apps/driver/app/trip.tsx')
  assert.match(trip, /<TripEndSummary card=\{trip\} \/>/)
  assert.match(trip, /tagsForStars=\{ratingTagOptions\}/)
  assert.match(trip, /onDone=\{\(\) => setRatingClosed\(true\)\}/)
  assert.match(trip, /<BackInQueue supabase=\{supabase\} driverId=\{user\.id\}/)
  const queue = read('../apps/driver/components/BackInQueue.tsx')
  assert.match(queue, /setDriverOnline\(supabase, driverId, false\)/)
  assert.match(queue, /from\('driver_status'\)\.select\('online'\)/)
})
