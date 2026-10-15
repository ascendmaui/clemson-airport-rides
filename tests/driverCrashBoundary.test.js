import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  boundaryCaught,
  boundaryRetried,
  crashRecord,
  forgetActiveTrip,
  initialBoundaryState,
  lastCrashRecord,
  recoveryCopy,
  rememberActiveTrip,
  rememberedActiveTrip,
  reportCrash,
  requestTripResume,
  scrubCrashText,
  takeTripResume,
} from '../apps/driver/lib/crashReport.ts'

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

test('a caught render error is logged once with the driver-crash tag and scope', () => {
  const lines = []
  const record = reportCrash('trip', new Error('Cannot read properties of null (reading id)'), '\n    in TripScreenBody', (...args) => lines.push(args))
  assert.equal(lines.length, 1)
  assert.equal(lines[0][0], '[driver-crash]')
  assert.equal(lines[0][1], 'trip')
  assert.match(lines[0][2], /TypeError|Error: Cannot read properties of null/)
  assert.equal(record.componentStack, 'in TripScreenBody')
  assert.equal(lastCrashRecord(), record)
})

test('crash logs never carry tokens or keys, and stay short', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk'
  assert.doesNotMatch(scrubCrashText(`failed with ${jwt}`), /eyJ/)
  assert.doesNotMatch(scrubCrashText('Bearer abc.def.ghi'), /abc\.def/)
  assert.doesNotMatch(scrubCrashText('key sk_live_123abc'), /sk_live_123abc/)
  assert.ok(scrubCrashText('x'.repeat(1000)).length <= 301)
  assert.equal(crashRecord('app', null).message, 'Unknown render error')
  assert.equal(crashRecord('app', 'boom').message, 'boom')
})

test('a throwing logger cannot take the recovery screen down', () => {
  assert.doesNotThrow(() => reportCrash('app', new Error('x'), null, () => { throw new Error('log failed') }))
})

test('boundary state: catch shows recovery, Try again clears it and remounts with a new key', () => {
  const caught = boundaryCaught(initialBoundaryState, new Error('render'))
  assert.ok(caught.error)
  assert.equal(caught.nonce, 0)
  const retried = boundaryRetried(caught)
  assert.equal(retried.error, null)
  assert.equal(retried.nonce, 1)
  assert.ok(boundaryCaught(retried, undefined).error, 'a thrown undefined still shows recovery')
})

test('recovery copy keeps the driver informed: still online, trip still active', () => {
  assert.match(recoveryCopy('trip').state, /trip is still active/)
  assert.match(recoveryCopy('home', { online: true }).state, /still online/)
  assert.match(recoveryCopy('app', { onTrip: true }).state, /trip is still active/)
  assert.equal(recoveryCopy('offers').action, 'Try again')
})

test('Back to my trip queues the remembered trip once; a finished trip is forgotten', () => {
  rememberActiveTrip('trip-1')
  assert.equal(rememberedActiveTrip(), 'trip-1')
  assert.equal(requestTripResume(), 'trip-1')
  assert.equal(takeTripResume(), 'trip-1')
  assert.equal(takeTripResume(), null, 'resume fires once')
  forgetActiveTrip('other')
  assert.equal(rememberedActiveTrip(), 'trip-1')
  forgetActiveTrip('trip-1')
  assert.equal(rememberedActiveTrip(), null)
})

test('boundary component: branded, Try again, logs, remounts, survives a missing theme', () => {
  const src = read('apps/driver/components/CrashBoundary.tsx')
  assert.match(src, /getDerivedStateFromError/)
  assert.match(src, /componentDidCatch[\s\S]*reportCrash\(/)
  assert.match(src, /key=\{this\.state\.nonce\}/)
  assert.match(src, /accessibilityLabel=\{copy\.action\}/)
  assert.match(src, /colors\.orange/)
  assert.match(src, /colors\.purple/)
  assert.match(src, /useOptionalTheme\(\)/)
  assert.match(src, /paletteFor\('light'\)/)
  assert.match(src, /Back to my trip/)
  assert.match(src, /requestTripResume\(tripId\)/)
  // Recovery never touches presence or the trip: no goOffline, no trip writes.
  assert.doesNotMatch(src, /goOffline|setDriverOnline|advanceTrip|driverTripAction/)
})

test('root layout, trip, offers and home are wrapped', () => {
  const layout = read('apps/driver/app/_layout.tsx')
  assert.match(layout, /<GestureHandlerRootView[^>]*>\s*<CrashBoundary scope="app"[^>]*>\s*<ThemeProvider>/)
  assert.match(layout, /<CrashBoundary scope="offer-alerts" compact>\s*<OfferBridge \/>/)
  assert.match(read('apps/driver/app/trip.tsx'), /<CrashBoundary scope="trip" title="Your trip" fill>\s*<TripScreenBody \/>/)
  assert.match(read('apps/driver/app/trip.tsx'), /rememberActiveTrip\(trip\.id\)/)
  assert.match(read('apps/driver/app/queue.tsx'), /<CrashBoundary scope="offers" title="Ride offers" fill>\s*<QueueScreenBody \/>/)
  assert.match(read('apps/driver/app/(tabs)/index.tsx'), /<CrashBoundary scope="home" title="Home" fill>\s*<DriverHomeBody \/>/)
  const resume = read('apps/driver/components/ActiveTripResume.tsx')
  assert.match(resume, /takeTripResume\(\)/)
  assert.match(resume, /router\.push\(\{ pathname: '\/trip', params: \{ id: tripId \} \}\)/)
})
