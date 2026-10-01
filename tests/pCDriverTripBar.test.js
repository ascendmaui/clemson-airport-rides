/**
 * Parallel C. Driver live-trip advance bar, headlines, and location publish.
 * Source contract plus the exported label functions. Does not edit the screen.
 * Does not assert fare cents.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { APPROACH_STATUSES } from '../apps/rider/lib/approachAlert.ts'
import { DRIVER_TRACK_STEPS, etaHoldLine, etaLineFor, STRAIGHT_LINE_WAIT } from '../packages/rides-native/liveTrip.js'
import { ACTIVE_RIDE_STATUSES } from '../packages/rides-native/safety.js'
import {
  acceptNeedsDriverOnline,
  driverStatusDetail,
  isActiveStatus,
  nextTripStatus,
  statusActionLabel,
  statusHeadline,
} from '../packages/rides-native/tripTags.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

const trip = read('apps/driver/app/trip.tsx')
const home = read('apps/driver/app/(tabs)/index.tsx')

const HEADLINES = {
  requested: 'A rider preferred you',
  searching: 'New ride request',
  offered: 'New ride request',
  scheduled: 'Scheduled ride',
  accepted: 'Head to pickup',
  arriving: 'Arriving at pickup',
  arrived: 'Waiting for the rider',
  in_progress: 'Trip in progress',
  completed: 'Completed',
  canceled: 'Canceled',
  cancelled_wait: 'Canceled',
}

const DETAILS = {
  requested: 'Accept to head to pickup. Declining cancels this request. It does not return to the open pool.',
  searching: 'Accept to take this ride. Declining leaves it in the open pool for another driver.',
  offered: 'Accept to take this ride. Declining leaves it in the open pool for another driver.',
  scheduled: 'This pickup is on the calendar. Accepting keeps it on your upcoming list.',
  accepted: 'Head to pickup. The time on this screen is a straight-line estimate from the coordinates already shared.',
  arriving: 'You are on the way. Mark that you are here when you reach pickup.',
  arrived: 'You are at pickup. Start the trip once the rider is in the car.',
  in_progress: 'The trip is underway. Head to drop-off, then complete it.',
  completed: 'This trip is complete.',
  canceled: 'This trip is canceled.',
  cancelled_wait: 'This trip is canceled.',
}

const ACTIONS = {
  accepted: 'Arriving',
  arriving: "I'm here",
  arrived: 'Start trip',
  in_progress: 'Complete trip',
}

test('status headlines and details cover the driver trip sheet', () => {
  for (const [status, headline] of Object.entries(HEADLINES)) {
    assert.equal(statusHeadline(status), headline, status)
    assert.equal(driverStatusDetail(status), DETAILS[status], status)
  }
  assert.equal(statusHeadline(''), 'Ride')
  assert.equal(statusHeadline(null), 'Ride')
  assert.equal(statusHeadline(undefined), 'Ride')
  assert.equal(statusHeadline('nope'), 'nope')
  assert.equal(driverStatusDetail(''), 'Trip status updates as you move through the ride.')
  assert.equal(driverStatusDetail(null), 'Trip status updates as you move through the ride.')
  assert.equal(driverStatusDetail('nope'), 'Trip status updates as you move through the ride.')
})

test('the advance button exists only for accepted, arriving, arrived, and in progress', () => {
  assert.deepEqual(ACTIONS, {
    accepted: 'Arriving',
    arriving: "I'm here",
    arrived: 'Start trip',
    in_progress: 'Complete trip',
  })
  for (const [status, label] of Object.entries(ACTIONS)) {
    assert.equal(statusActionLabel(status), label, status)
    assert.equal(nextTripStatus(status) != null, true, status)
  }
  for (const status of ['requested', 'searching', 'offered', 'scheduled', 'completed', 'canceled', 'cancelled_wait', '', null]) {
    assert.equal(statusActionLabel(status), null, String(status))
  }
  assert.equal(nextTripStatus('accepted'), 'arriving')
  assert.equal(nextTripStatus('arriving'), 'arrived')
  assert.equal(nextTripStatus('arrived'), 'in_progress')
  assert.equal(nextTripStatus('in_progress'), 'completed')
  assert.equal(nextTripStatus('completed'), null)
  assert.equal(nextTripStatus('canceled'), null)
  assert.equal(nextTripStatus('cancelled_wait'), null)
  assert.equal(nextTripStatus('requested'), null)
})

test('driver active statuses include arrived and exclude the SOS-only split', () => {
  for (const status of ['accepted', 'arriving', 'arrived', 'in_progress']) {
    assert.equal(isActiveStatus(status), true, status)
  }
  for (const status of ['searching', 'offered', 'requested', 'scheduled', 'completed', 'canceled', 'cancelled_wait', '']) {
    assert.equal(isActiveStatus(status), false, status)
  }
  assert.equal(isActiveStatus('arrived'), true)
  assert.equal(ACTIVE_RIDE_STATUSES.includes('arrived'), false)
  assert.equal(APPROACH_STATUSES.includes('arrived'), true)
  assert.equal(isActiveStatus('in_progress'), true)
  assert.equal(APPROACH_STATUSES.includes('in_progress'), false)
  assert.equal(ACTIVE_RIDE_STATUSES.includes('in_progress'), true)
  assert.equal(acceptNeedsDriverOnline('searching'), true)
  assert.equal(acceptNeedsDriverOnline('offered'), true)
  assert.equal(acceptNeedsDriverOnline('requested'), true)
  assert.equal(acceptNeedsDriverOnline('scheduled'), false)
  assert.equal(acceptNeedsDriverOnline('accepted'), false)
  assert.equal(acceptNeedsDriverOnline('in_progress'), false)
})

test('track steps skip canceled and the sheet asks for drop-off only after start', () => {
  assert.deepEqual(DRIVER_TRACK_STEPS.map((step) => step.id), ['accepted', 'arriving', 'arrived', 'in_progress', 'completed'])
  assert.deepEqual(DRIVER_TRACK_STEPS.map((step) => step.label), ['Accepted', 'En route', 'Arrived', 'In trip', 'Done'])
  function stepIndex(status) {
    return DRIVER_TRACK_STEPS.findIndex((step) => step.id === status)
  }
  assert.equal(stepIndex('accepted'), 0)
  assert.equal(stepIndex('arriving'), 1)
  assert.equal(stepIndex('arrived'), 2)
  assert.equal(stepIndex('in_progress'), 3)
  assert.equal(stepIndex('completed'), 4)
  assert.equal(stepIndex('canceled'), -1)
  assert.equal(stepIndex('cancelled_wait'), -1)
  assert.equal(stepIndex('searching'), -1)
  assert.match(trip, /DRIVER_TRACK_STEPS\.findIndex\(\(step\) => step\.id === trip\?\.status\)/)
  assert.match(trip, /const headingToDropoff = trip\?\.status === 'in_progress' \|\| trip\?\.status === 'completed'/)
  assert.equal(trip.includes("status === 'cancelled_wait'"), false)
  assert.match(trip, /headingToDropoff \? 'drop-off' : 'pickup'/)
})

test('a missing ETA on an active trip stays the straight-line hold', () => {
  assert.equal(etaHoldLine('accepted', null), STRAIGHT_LINE_WAIT)
  assert.equal(etaHoldLine('arriving', ''), STRAIGHT_LINE_WAIT)
  assert.equal(etaHoldLine('arrived', null), STRAIGHT_LINE_WAIT)
  assert.equal(etaHoldLine('in_progress', null), STRAIGHT_LINE_WAIT)
  assert.equal(etaHoldLine('completed', null), null)
  assert.equal(etaHoldLine('canceled', null), null)
  assert.equal(etaHoldLine('accepted', 'About 4 min · 1.2 mi straight line to pickup'), 'About 4 min · 1.2 mi straight line to pickup')
  assert.equal(etaLineFor('completed', { lat: 34.68, lng: -82.84 }, { dropoffLat: 34.85, dropoffLng: -82.4 }), null)
  assert.equal(etaLineFor('arrived', null, { pickupLat: 34.68, pickupLng: -82.84 }), null)
  assert.match(home, /etaHoldLine\(desk\.active\.status, etaLineFor\(desk\.active\.status, liveFrom, desk\.active\)\)/)
  assert.match(trip, /etaHoldLine\(\s*trip\.status,\s*etaLineFor\(/)
})

test('the trip screen publishes online true without the GO gate', () => {
  assert.match(home, /useDriverLocation\(Boolean\(user && approved && online\)/)
  assert.match(trip, /useDriverLocation\(Boolean\(user && trip && trip\.status !== 'completed' && trip\.status !== 'canceled'\)/)
  assert.equal(trip.includes('approved'), false)
  assert.equal(trip.includes('canGoOnline'), false)
  assert.equal(trip.includes('GoButton'), false)
  assert.equal((trip.match(/online: true/g) || []).length, 1)
  assert.match(trip, /publishDriverLocation\(supabase, user\.id, \{ \.\.\.fix, online: true \}\)/)
  assert.match(home, /publishDriverLocation\(supabase, user\.id, \{ \.\.\.fix, online: true \}\)/)
  assert.match(trip, /trip\.status === 'completed' \|\| trip\.status === 'canceled'\) return undefined/)
  const poll = trip.slice(trip.indexOf('loadRiderFix(supabase'), trip.indexOf('useDriverLocation(Boolean'))
  assert.match(poll, /setInterval\(pull, 5000\)/)
  assert.equal(poll.includes('cancelled_wait'), false)
  assert.equal(poll.includes('approved'), false)
})

test('advance, rate, and the missing-trip lines stay on the sheet', () => {
  const advance = trip.slice(trip.indexOf('async function onAdvance'), trip.indexOf('const headingToDropoff'))
  assert.match(advance, /if \(!supabase \|\| !user \|\| !trip\) return/)
  assert.match(advance, /result\?\.status === 'completed'/)
  assert.match(advance, /pulse\('complete'\)/)
  assert.match(advance, /pulse\('accept'\)/)
  assert.match(advance, /Could not update this trip/)
  assert.match(advance, /Fare collected\. Payout /)
  assert.match(advance, /rider.s saved card or Apple Pay/)
  assert.match(trip, /title=\{trip \? statusHeadline\(trip\.status\) : 'Loading trip'\}/)
  assert.match(trip, /body=\{trip \? driverStatusDetail\(trip\.status\) : 'Loading this ride\.'\}/)
  assert.match(trip, /\{action \? <Primary label=\{busy \? 'Updating…' : action\} onPress=\{onAdvance\} disabled=\{busy\} tone="purple" \/> : null\}/)
  assert.match(trip, /trip\.status === 'completed' && user \?/)
  assert.match(trip, /onDone=\{\(\) => router\.replace\('\/'\)\}/)
  assert.match(trip, /onLater=\{\(\) => router\.replace\('\/'\)\}/)
  assert.match(trip, /<CounterpartCard person=\{person\}/)
  assert.match(trip, /\{id \? 'This trip is not on your account yet\.' : 'Missing trip id\.'\}/)
  assert.match(trip, /← LIVE TRIP/)
  const kicker = trip.slice(trip.indexOf('<Text style={styles.kicker}'), trip.indexOf('</Text>', trip.indexOf('<Text style={styles.kicker}')))
  assert.equal(kicker.includes('accessibilityLabel'), false)
  assert.equal(kicker.includes('accessibilityRole'), false)
})

test('maps buttons follow the chosen app and the rider pin is optional', () => {
  assert.match(trip, /navApp === 'google' \? \['google', 'apple'\] as const : \['apple', 'google'\] as const/)
  assert.match(trip, /accessibilityLabel=\{`Open directions in \$\{provider === 'apple' \? 'Apple Maps' : 'Google Maps'\}`\}/)
  assert.match(trip, /accessibilityHint=\{`Opens navigation to \$\{headingToDropoff \? 'drop-off' : 'pickup'\}`\}/)
  assert.match(trip, /Could not open maps/)
  assert.match(trip, /accessibilityLabel="Trip details"/)
  assert.match(trip, /accessibilityHint="Navigates to detailed trip breakdown and receipt"/)
  assert.match(trip, /pathname: '\/trip-details'/)
  assert.match(trip, /\{rider \? `\$\{trip\.firstName\} is sharing a live pin\.` : 'Rider pin shows when they share location on this trip\. Pickup and drop-off stay on the map\.'\}/)
  assert.match(trip, /if \(rider && !headingToDropoff\) route\.push\(rider\)/)
  assert.match(trip, /pinColor: ORANGE/)
  assert.match(trip, /pinColor: PURPLE/)
  assert.match(trip, /trip\.teslaStub \? <Text style=\{styles\.copy\}>\{TESLA_FLEET_NOTICE\}<\/Text> : null/)
  assert.match(trip, /formatCents\(trip\.driverNetCents\)/)
  assert.equal(trip.includes('tripEarnedCents'), false)
  assert.equal(trip.includes('earningsMath'), false)
  assert.match(trip, /TODO: road-following tiles need a billed Maps key/)
})
