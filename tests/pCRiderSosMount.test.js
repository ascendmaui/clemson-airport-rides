/**
 * Parallel C. Where the rider mounts SOS and the approach overlay.
 * Source contract only. Does not edit the screens.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { APPROACH_STATUSES } from '../apps/rider/lib/approachAlert.ts'
import { ACTIVE_RIDE_STATUSES, SHAREABLE_TRIP_STATUSES } from '../packages/rides-native/safety.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

const safety = read('apps/rider/app/safety.tsx')
const requested = read('apps/rider/app/requested.tsx')
const layout = read('apps/rider/app/_layout.tsx')
const hook = read('apps/rider/lib/useRiderTrip.ts')

test('approach statuses and SOS log statuses are not the same set', () => {
  assert.deepEqual([...APPROACH_STATUSES], ['accepted', 'arriving', 'arrived'])
  assert.deepEqual([...ACTIVE_RIDE_STATUSES], ['accepted', 'arriving', 'in_progress'])
  assert.equal(APPROACH_STATUSES.includes('in_progress'), false)
  assert.equal(ACTIVE_RIDE_STATUSES.includes('arrived'), false)
  assert.equal(SHAREABLE_TRIP_STATUSES.includes('arrived'), false)
  assert.equal(SHAREABLE_TRIP_STATUSES.includes('in_progress'), true)
  assert.equal(SHAREABLE_TRIP_STATUSES.includes('searching'), true)
})

test('the root layout hosts one approach alert from the approaching trip', () => {
  const host = layout.slice(layout.indexOf('function ApproachHost'), layout.indexOf('function Gate'))
  assert.match(host, /const trip = useApproachingTrip\(user\?\.id \|\| null\)/)
  assert.match(host, /<ApproachAlert status=\{trip\?\.status \?\? null\} driverId=\{trip\?\.driver_id \?\? null\} \/>/)
  assert.equal((layout.match(/<ApproachAlert/g) || []).length, 1)
  assert.equal(layout.includes('SosSheet'), false)
})

test('the approaching-trip hook polls accepted, arriving, and arrived', () => {
  const fn = hook.slice(hook.indexOf('export function useApproachingTrip'), hook.indexOf('return trip'))
  assert.match(fn, /\.in\('status', \[\.\.\.APPROACH_STATUSES\]\)/)
  assert.match(fn, /\.order\('requested_at', \{ ascending: false \}\)/)
  assert.match(fn, /\.limit\(1\)/)
  assert.match(fn, /rider-approach-\$\{userId\}/)
  assert.match(fn, /filter: `rider_id=eq\.\$\{userId\}`/)
  assert.match(fn, /\}, 15000\)/)
  assert.match(fn, /if \(!userId \|\| !supabase\)/)
  assert.match(fn, /setTrip\(null\)/)
  assert.match(fn, /if \(!alive \|\| queryError\) return/)
})

test('Safety keeps the SOS button while signed out and logs only a live trip', () => {
  assert.match(safety, /const rideLive = isActiveRideStatus\(trip\?\.status\)/)
  assert.match(safety, /<SosButton onPress=\{\(\) => setSosOpen\(true\)\} \/>/)
  assert.match(safety, /accessibilityLabel="Back"/)
  assert.match(safety, /Sign in to use Safety/)
  assert.match(safety, /Live location, SOS logs, and emergency contacts stay on your account\./)
  assert.match(safety, /SOS logging waits for an active ride/)
  assert.match(safety, /You can still open SOS to call 911 or Clemson Police\./)
  assert.match(safety, /The in-app alert is saved once a driver has accepted\./)
  assert.match(safety, /This ride is \{trip\?\.status\}\. SOS fills the screen in red\./)
  assert.match(safety, /The first press confirms and does not dial, then logs the alert on the trip\./)
  assert.match(safety, /label="Open SOS"/)
  assert.match(safety, /<SosIncomingBanner tripId=\{trip\?\.id \|\| null\} userId=\{user\.id\} active=\{rideLive\} \/>/)
  const sheet = safety.slice(safety.indexOf('<SosSheet'))
  assert.match(sheet, /tripId=\{trip\?\.id \|\| null\}/)
  assert.match(sheet, /tripStatus=\{trip\?\.status \|\| null\}/)
  assert.match(sheet, /userId=\{user\?\.id \|\| null\}/)
  assert.match(sheet, /contacts=\{contacts\}/)
  assert.ok(safety.indexOf('<SosButton') < safety.indexOf('!user'))
})

test('the live ride screen splits SOS trip id from trip status', () => {
  assert.match(requested, /const rideLive = isActiveRideStatus\(trip\?\.status\)/)
  assert.match(requested, /const shown = trip \|\| \(tripId/)
  assert.match(requested, /<SosIncomingBanner tripId=\{shown\?\.id \|\| null\} userId=\{user\?\.id \|\| null\} active=\{rideLive\} \/>/)
  const sheet = requested.slice(requested.indexOf('<SosSheet'))
  assert.match(sheet, /tripId=\{shown\?\.id \|\| null\}/)
  assert.match(sheet, /tripStatus=\{trip\?\.status \|\| null\}/)
  assert.equal(sheet.includes('tripStatus={shown'), false)
  assert.match(requested, /SOS fills the screen in red\. The first press confirms and does not dial\. Call 911 is the next press\./)
  assert.match(requested, /Waiting for an active ride/)
  assert.match(requested, /SOS is logged once the trip is accepted, arriving, or in progress\./)
  assert.match(requested, /accessibilityLabel="Emergency contacts"/)
  assert.match(requested, /router\.push\('\/safety'\)/)
  assert.match(requested, /label="Open SOS"/)
})

test('the live ride header renders the kicker and title twice', () => {
  const header = requested.slice(requested.indexOf('<View style={styles.headerCopy}>'), requested.indexOf('<SosButton'))
  assert.equal((header.match(/<Text style=\{styles\.kicker\}/g) || []).length, 2)
  assert.equal((header.match(/<Text style=\{styles\.title\}/g) || []).length, 2)
  assert.match(header, /\{ttlCanceled \? 'HOLD EXPIRED' : 'LIVE RIDE'\}/)
  assert.match(header, />LIVE RIDE</)
  assert.match(header, /accessibilityRole="header"/)
  assert.match(header, /accessibilityLiveRegion="polite"/)
  const firstTitle = header.indexOf('<Text style={styles.title}>{phase.title}</Text>')
  const secondTitle = header.indexOf('accessibilityRole="header"')
  assert.ok(firstTitle >= 0)
  assert.ok(firstTitle < secondTitle)
})
