/**
 * Parallel C. Earnings activity list: filters, day groups, empty copy.
 * Mirrors the screen's grouping. Does not call fare helpers and does not
 * assert cents. Does not edit the screen.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

const activity = read('apps/driver/app/earnings-activity.tsx')
const home = read('apps/driver/app/(tabs)/index.tsx')
const hub = read('apps/driver/app/(tabs)/earnings.tsx')

function visibleTrips(trips, filter) {
  return trips.filter((trip) => {
    if (filter === 'all') return true
    return trip.status === filter
  })
}

function groupByCompletedDay(trips) {
  const map = new Map()
  for (const trip of trips) {
    const key = (trip.completed_at || '').slice(0, 10) || 'Undated'
    const list = map.get(key) || []
    list.push(trip)
    map.set(key, list)
  }
  return [...map.entries()]
}

function rowTitle(status) {
  return status === 'canceled' ? 'Canceled' : 'Clemson RIDES'
}

function rowKind(status) {
  return status === 'canceled' ? 'Canceled trip' : 'Completed trip'
}

function showsPayoutAmount(status) {
  return status !== 'canceled'
}

const sample = [
  { id: 'a', status: 'completed', completed_at: '2026-09-24T16:00:00.000Z', pickup_label: 'Tillman', dropoff_label: 'GSP' },
  { id: 'b', status: 'canceled', completed_at: '2026-09-24T18:00:00.000Z', pickup_label: '', dropoff_label: null },
  { id: 'c', status: 'completed', completed_at: '2026-09-24T03:30:00.000Z', pickup_label: 'Library', dropoff_label: 'Downtown' },
  { id: 'd', status: 'completed', completed_at: '', pickup_label: 'Home', dropoff_label: 'Campus' },
  { id: 'e', status: 'completed', completed_at: null, pickup_label: 'No date', dropoff_label: 'Still none' },
  { id: 'f', status: 'cancelled', completed_at: '2026-09-25T01:00:00.000Z', pickup_label: 'British', dropoff_label: 'Spelling' },
  { id: 'g', status: 'offered', completed_at: '2026-09-25T01:00:00.000Z', pickup_label: 'Open', dropoff_label: 'Pool' },
]

test('chips say Trips for completed and the screen does not zone the day key', () => {
  assert.match(activity, /id: 'all', label: 'All'/)
  assert.match(activity, /id: 'completed', label: 'Trips'/)
  assert.match(activity, /id: 'canceled', label: 'Canceled'/)
  assert.match(activity, /case 'completed':\s*return 'Trips'/)
  assert.match(activity, /case 'canceled':\s*return 'Canceled'/)
  assert.match(activity, /useState<Filter>\('all'\)/)
  assert.match(activity, /if \(filter === 'all'\) return true/)
  assert.match(activity, /return trip\.status === filter/)
  assert.match(activity, /const key = \(trip\.completed_at \|\| ''\)\.slice\(0, 10\) \|\| 'Undated'/)
  assert.equal(activity.includes('America/New_York'), false)
  assert.equal(activity.includes('earningsMath'), false)
  assert.equal(activity.includes('canceled_at'), false)
  assert.equal(activity.includes('stripe'), false)
  assert.equal(activity.includes('Stripe'), false)
})

test('day groups follow the UTC date prefix and keep insertion order', () => {
  const groups = groupByCompletedDay(visibleTrips(sample, 'all'))
  assert.deepEqual(groups.map(([day]) => day), ['2026-09-24', 'Undated', '2026-09-25'])
  assert.deepEqual(groups[0][1].map((trip) => trip.id), ['a', 'b', 'c'])
  assert.deepEqual(groups[1][1].map((trip) => trip.id), ['d', 'e'])
  assert.deepEqual(groups[2][1].map((trip) => trip.id), ['f', 'g'])
  const earlyUtc = groupByCompletedDay([{ id: 'z', status: 'completed', completed_at: '2026-09-24T03:00:00.000Z' }])
  assert.equal(earlyUtc[0][0], '2026-09-24')
  const spaces = groupByCompletedDay([{ id: 's', status: 'completed', completed_at: '   ' }])
  assert.equal(spaces[0][0], '   ')
})

test('completed and canceled filters are exact status matches', () => {
  assert.deepEqual(visibleTrips(sample, 'completed').map((trip) => trip.id), ['a', 'c', 'd', 'e'])
  assert.deepEqual(visibleTrips(sample, 'canceled').map((trip) => trip.id), ['b'])
  assert.equal(visibleTrips(sample, 'canceled').some((trip) => trip.status === 'cancelled'), false)
  assert.deepEqual(visibleTrips([], 'all'), [])
  assert.deepEqual(groupByCompletedDay([]), [])
  const undatedOnly = groupByCompletedDay(visibleTrips(sample, 'completed'))
  assert.deepEqual(undatedOnly.map(([day]) => day), ['2026-09-24', 'Undated'])
})

test('a non-canceled row is titled like a completed trip and still offers a payout line', () => {
  assert.equal(rowTitle('canceled'), 'Canceled')
  assert.equal(rowTitle('completed'), 'Clemson RIDES')
  assert.equal(rowTitle('cancelled'), 'Clemson RIDES')
  assert.equal(rowTitle('offered'), 'Clemson RIDES')
  assert.equal(rowTitle(undefined), 'Clemson RIDES')
  assert.equal(rowKind('canceled'), 'Canceled trip')
  assert.equal(rowKind('offered'), 'Completed trip')
  assert.equal(rowKind('cancelled'), 'Completed trip')
  assert.equal(showsPayoutAmount('canceled'), false)
  assert.equal(showsPayoutAmount('completed'), true)
  assert.equal(showsPayoutAmount('cancelled'), true)
  assert.equal((activity.match(/status === 'canceled'/g) || []).length, 4)
  assert.equal((activity.match(/status !== 'canceled'/g) || []).length, 1)
  assert.match(activity, /trip\.status === 'canceled' \? 'Canceled trip' : 'Completed trip'/)
  assert.match(activity, /trip\.status === 'canceled' \? 'Canceled' : 'Clemson RIDES'/)
  assert.match(activity, /trip\.status === 'canceled' \? 'No payout' : shownCents\(tripEarnedCents\(trip\), earningsPrivate\)/)
  assert.match(activity, /trip\.status !== 'canceled' && pay\?\.showBonus/)
  assert.match(activity, /pickup_label \|\| 'Pickup'/)
  assert.match(activity, /dropoff_label \|\| 'Drop-off'/)
  assert.equal(activity.includes('formatCents('), false)
})

test('empty, signed-out, and clear-filter chrome', () => {
  assert.match(activity, /<StackPage title="Earnings activity"/)
  assert.match(activity, /No trips in this filter/)
  assert.match(activity, /Completed and canceled trips from your driver account show up here\./)
  assert.match(activity, /\{user && groups\.length === 0 \?/)
  assert.match(activity, /\{!user \? <Primary label="Sign in" onPress=\{\(\) => router\.push\('\/sign-in'\)\} \/> : null\}/)
  assert.match(activity, /\{filter !== 'all' \?/)
  assert.match(activity, /accessibilityLabel="Clear filter"/)
  assert.match(activity, /accessibilityHint="Resets filter to show all trips"/)
  assert.match(activity, /onPress=\{\(\) => setFilter\('all'\)\}/)
  assert.match(activity, /accessibilityRole="tab"/)
  assert.match(activity, /accessibilityLabel=\{`\$\{filterLabel\(item\.id\)\} filter`\}/)
  assert.match(activity, /accessibilityState=\{\{ selected: on \}\}/)
  assert.match(activity, /Could not load activity/)
  assert.match(activity, /if \(!user \|\| !supabase\) return/)
  assert.match(activity, /setTrips\(data\.trips \|\| \[\]\)/)
  assert.match(activity, /loadEarnings\(supabase, user\.id\)/)
  assert.match(activity, /pathname: '\/trip-details'/)
  assert.match(activity, /accessibilityHint="Opens trip details and breakdown"/)
  assert.match(activity, /hitSlop=\{\{ top: 8, bottom: 8, left: 4, right: 4 \}\}/)
  assert.match(activity, /hitSlop=\{\{ top: 12, bottom: 12, left: 12, right: 12 \}\}/)
})

test('the home peek opens activity and the earnings tab does not', () => {
  assert.match(home, /label="See earnings activity"/)
  assert.match(home, /router\.push\('\/earnings-activity'\)/)
  assert.match(home, /\{lastTrip \? `Last trip · \$\{lastTrip\}` : 'No completed trip yet'\}/)
  assert.match(home, /accessibilityLabel=\{earningsPrivate \? 'Show earnings' : 'Hide earnings'\}/)
  assert.equal(hub.includes('earnings-activity'), false)
  assert.equal(hub.includes('See earnings activity'), false)
  assert.match(activity, /import \{ carpoolPayFromTrip, tripEarnedCents \} from 'rides-native\/tripTags'/)
  assert.match(activity, /const pay = carpoolPayFromTrip\(trip\)/)
  assert.match(activity, /Base net \{shownCents\(pay\.baseNetCents, earningsPrivate\)\}/)
  const bonus = activity.slice(activity.indexOf('pay?.showBonus'), activity.indexOf('</Text>', activity.indexOf('pay?.showBonus')))
  assert.match(bonus, /pay\.incentiveId/)
  assert.match(bonus, /pay\.bonusCents/)
  assert.match(bonus, /pay\.payoutCents/)
})
