/**
 * Parallel C. Rider history SOS entry and driver trip-details chrome.
 * Source contract. Does not edit the screens and does not assert fare cents.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { APPROACH_STATUSES } from '../apps/rider/lib/approachAlert.ts'
import {
  ACTIVE_RIDE_STATUSES,
  isShareableTripStatus,
  SHAREABLE_TRIP_STATUSES,
} from '../packages/rides-native/safety.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

const history = read('apps/rider/app/history.tsx')
const details = read('apps/driver/app/trip-details.tsx')
const account = read('apps/rider/app/account.tsx')

test('history offers SOS only for the shareable statuses', () => {
  assert.deepEqual([...SHAREABLE_TRIP_STATUSES], ['searching', 'offered', 'accepted', 'arriving', 'in_progress'])
  for (const status of SHAREABLE_TRIP_STATUSES) {
    assert.equal(isShareableTripStatus(status), true, status)
  }
  for (const status of ['arrived', 'requested', 'scheduled', 'completed', 'canceled', 'cancelled_wait', 'Accepted', '', null, undefined]) {
    assert.equal(isShareableTripStatus(status), false, String(status))
  }
  assert.equal(isShareableTripStatus('arrived'), false)
  assert.equal(APPROACH_STATUSES.includes('arrived'), true)
  assert.equal(ACTIVE_RIDE_STATUSES.includes('arrived'), false)
  assert.equal(isShareableTripStatus('in_progress'), true)
  assert.equal(APPROACH_STATUSES.includes('in_progress'), false)
})

test('the history row gates rate, lost and found, and the SOS link', () => {
  assert.match(history, /import \{ isShareableTripStatus \} from 'rides-native\/safety\.js'/)
  assert.equal(history.includes('SosSheet'), false)
  assert.equal(history.includes('ApproachAlert'), false)
  assert.match(history, /\{row\.status === 'completed' && row\.driver_id \?/)
  assert.equal((history.match(/row\.status === 'completed' && row\.driver_id/g) || []).length, 2)
  assert.match(history, /accessibilityLabel="Rate this ride"/)
  assert.match(history, /accessibilityHint="Opens the rating screen"/)
  assert.match(history, /pathname: '\/rate', params: \{ trip: row\.id \}/)
  assert.match(history, /accessibilityLabel="Lost and found"/)
  assert.match(history, /pathname: '\/lost-found', params: \{ trip: row\.id \}/)
  assert.match(history, /\{isShareableTripStatus\(row\.status\) \?/)
  assert.match(history, /accessibilityLabel="Share location and SOS"/)
  assert.match(history, /accessibilityHint="Opens live trip sharing"/)
  assert.match(history, /pathname: '\/requested', params: \{ trip: row\.id, dest: row\.dropoff_label \|\| '' \}/)
  assert.match(history, /Share location & SOS/)
  assert.match(history, /\{row\.dropoff_label \|\| 'Ride'\}/)
  assert.match(history, /\{row\.pickup_label \|\| 'Pickup'\} · \{row\.status \|\| 'requested'\}/)
})

test('history loads twenty newest trips and does not clear rows on sign-out', () => {
  const gate = history.slice(history.indexOf('useEffect(() => {'), history.indexOf('let alive'))
  assert.match(gate, /if \(!user \|\| !supabase\) return undefined/)
  assert.equal(gate.includes('setRows'), false)
  assert.match(history, /\.eq\('rider_id', user\.id\)/)
  assert.match(history, /\.order\('created_at', \{ ascending: false \}\)/)
  assert.match(history, /\.limit\(20\)/)
  assert.match(history, /if \(!alive\) return/)
  assert.match(history, /if \(queryError\) setError\(queryError\.message\)/)
  assert.match(history, /else setRows\(\(data \|\| \[\]\) as RideRow\[\]\)/)
  assert.match(history, /Sign in to see rides on this account\./)
  assert.match(history, /<PrimaryButton label="Sign in" onPress=\{\(\) => router\.push\('\/sign-in'\)\} \/>/)
  assert.match(history, /\{loading \? <Text style=\{styles\.copy\}>Loading…<\/Text> : null\}/)
  assert.match(history, /\{user && !loading && !error && rows\.length === 0 \?/)
  assert.match(history, /No rides yet\. Campus → GSP starts from the map\./)
  const back = history.slice(history.indexOf('<Pressable onPress={() => router.back()}'), history.indexOf('</Pressable>'))
  assert.equal(back.includes('accessibilityLabel'), false)
  assert.equal(back.includes('accessibilityRole'), false)
  assert.match(history, /formatCents\(row\.fare_cents \|\| 0\)/)
  assert.equal(history.includes('tripEarnedCents'), false)
})

test('trip details keeps duration blank and opens the live trip for every loaded status', () => {
  assert.match(details, /title="Trip details"/)
  assert.match(details, /\{id \? 'This trip is not on your account yet\.' : 'Missing trip id\.'\}/)
  assert.match(details, /Could not load this trip/)
  assert.match(details, /if \(!supabase \|\| !id\) return/)
  assert.match(details, /if \(!user\) return/)
  assert.match(details, /<Text style=\{\{ color: colors\.inkSecondary \}\}>Duration<\/Text>/)
  assert.match(details, /Not recorded/)
  assert.match(details, /miles == null \? 'Not recorded' : `\$\{miles\.toFixed\(2\)\} mi straight-line`/)
  assert.match(details, /const when = trip\?\.pickupAt \? formatPickupAt\(trip\.pickupAt\) : 'Time not recorded'/)
  assert.match(details, /label="Open live trip"/)
  assert.match(details, /pathname: '\/trip', params: \{ id: trip\.id \}/)
  assert.match(details, /\{trip\.status === 'completed' \?/)
  assert.match(details, /label="Rate your rider"/)
  assert.match(details, /pathname: '\/rate', params: \{ trip: trip\.id \}/)
  assert.equal(details.includes('SosSheet'), false)
  assert.equal(details.includes('GoButton'), false)
  assert.equal(details.includes('statusActionLabel'), false)
})

test('a tip row of zero is not the same as no tip row', () => {
  assert.match(details, /setTip\(payments\.some\(\(payment: TipPayment\) => payment\.kind === 'tip'\) \? cents : null\)/)
  assert.match(details, /\{tip != null && tip > 0 \?/)
  assert.match(details, /You earned more because the rider left a tip\./)
  assert.match(details, /\{tip != null \?/)
  assert.match(details, /tip > 0 \? `\$\{formatCents\(tip\)\} tip on the payment record` : 'Tip row is zero'/)
  assert.match(details, /No tip payment is on this trip\./)
  assert.match(details, /Thanks notes are not sent from the driver app yet\./)
  assert.match(details, /shownCents\(trip\.driverNetCents, earningsPrivate\)/)
  assert.match(details, /shownCents\(trip\.fareCents, earningsPrivate\)/)
  assert.match(details, /\{trip\.carpoolIncentiveId \?/)
  assert.equal(details.includes('tripEarnedCents'), false)
  assert.equal(details.includes('platformFee'), false)
})

test('account opens Safety without naming the button', () => {
  const card = account.slice(account.indexOf("router.push('/safety')") - 80, account.indexOf('Share a trip link'))
  assert.match(card, /accessibilityRole="button"/)
  assert.equal(card.includes('accessibilityLabel'), false)
  assert.match(account, /SOS, live location, emergency contacts/)
  assert.match(account, /Share a trip link and confirm an alert before anyone is called\./)
  assert.match(account, /href: '\/history', label: 'Your rides'/)
  assert.equal(account.includes('SosSheet'), false)
  assert.match(account, /label="Rate your last ride"/)
  assert.match(account, /pathname: '\/rate', params: \{ trip: pendingTrip \}/)
})

test('the help mark on trip details has no accessibility name', () => {
  const help = details.slice(details.indexOf('right={<Text'), details.indexOf('>?</Text>'))
  assert.match(help, /router\.push\('\/learning'\)/)
  assert.equal(help.includes('accessibilityLabel'), false)
  assert.equal(help.includes('accessibilityRole'), false)
  assert.match(details, /teslaFleetNotice\(Boolean\(trip\?\.teslaStub\)\)/)
  assert.match(details, /route=\{route\.length > 1 \? route : undefined\}/)
  assert.match(details, /center=\{pins\[0\] \? \{ latitude: pins\[0\]\.latitude, longitude: pins\[0\]\.longitude \} : null\}/)
  assert.match(details, /pinColor: PURPLE/)
  assert.match(details, /pinColor: ORANGE/)
  assert.match(details, /straightLineMiles\(/)
})
