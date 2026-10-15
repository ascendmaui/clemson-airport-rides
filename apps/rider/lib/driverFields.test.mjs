import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  guardValue,
  readHoldPrompt,
  readPaymentFailedMoment,
  readTrackingIssue,
  rosterCard,
  safeCounterpart,
  sanitizeOnlineDrivers,
  textField,
  tripCountLabel,
} from './driverFields.ts'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('trip counts and driver strings stay renderable when the row is partial', () => {
  assert.equal(tripCountLabel(null), '0')
  assert.equal(tripCountLabel(undefined), '0')
  assert.equal(tripCountLabel('nope'), '0')
  assert.equal(tripCountLabel(-4), '0')
  assert.equal(tripCountLabel(1234), '1,234')
  assert.equal(tripCountLabel('1500.9'), '1,500')
  assert.equal(textField(null, 'Driver'), 'Driver')
  assert.equal(textField('  ', 'Driver'), 'Driver')
  assert.equal(textField('Avery', 'Driver'), 'Avery')
  const cards = [null, { tripCount: null, rating: null }, { id: 'sim-busy-1', tripCount: null, name: null, vehicleLabel: null }]
    .map((driver) => rosterCard(driver))
  assert.equal(cards[0], null)
  assert.equal(cards[1], null)
  assert.equal(cards[2]?.tripCountLabel, '0')
  assert.equal(cards[2]?.name, 'Driver')
  assert.equal(cards[2]?.vehicleLabel, 'Vehicle')
  assert.equal(cards[2]?.rating, '—')
  assert.doesNotThrow(() => cards.map((card) => card?.tripCountLabel))
})

test('fetched driver rows drop nulls before they are merged into the picker', () => {
  const merged = sanitizeOnlineDrivers([
    null,
    { name: 'Missing id' },
    { id: '  ' },
    { id: 'drv-1', name: null, vehicleLabel: null, online: 1, plate: '  ' },
    { id: 'drv-2', name: 'Mei', vehicleLabel: 'Blue Kia', online: false, plate: 'ABC123' },
  ])
  assert.deepEqual(merged.map((driver) => driver.id), ['drv-1', 'drv-2'])
  assert.equal(merged[0].name, 'Driver')
  assert.equal(merged[0].vehicleLabel, 'Vehicle')
  assert.equal(merged[0].online, true)
  assert.equal(merged[0].plate, null)
  assert.equal(merged[1].name, 'Mei')
  assert.equal(sanitizeOnlineDrivers(null).length, 0)
})

test('a partial matched driver does not throw when the live card reads it', () => {
  assert.equal(safeCounterpart(null), null)
  const person = safeCounterpart({
    id: 'drv',
    name: null,
    roleLabel: null,
    spots: null,
    ratingLine: null,
    initial: null,
  })
  assert.equal(person.name, 'Driver')
  assert.equal(person.roleLabel, 'Driver')
  assert.deepEqual(person.spots, [])
  assert.equal(person.initial, 'D')
  assert.doesNotThrow(() => person.roleLabel.toUpperCase())
  assert.doesNotThrow(() => person.spots.length)
})

test('a failed hold, a tracking stall, and a throwing reader cannot escape', () => {
  assert.equal(guardValue(() => { throw new TypeError('map') }, 'safe'), 'safe')
  const boom = {}
  Object.defineProperty(boom, 'metadata', { get() { throw new TypeError('hold') } })
  assert.equal(readHoldPrompt(boom), null)
  assert.equal(readHoldPrompt(null), null)
  const row = { id: 'trip-1' }
  Object.defineProperty(row, 'metadata', { get() { throw new TypeError('hold') } })
  assert.equal(readPaymentFailedMoment('held', row, 'rider'), null)
  assert.equal(readPaymentFailedMoment('held', { id: 'trip-1', metadata: null }, 'rider'), null)
  assert.equal(readTrackingIssue(null, null), null)
  assert.equal(readTrackingIssue('accepted', null, 1_000, null), 'Waiting for driver location. Retrying automatically.')
  const throwingNow = {}
  Object.defineProperty(throwingNow, 'valueOf', { value() { throw new TypeError('stall') } })
  assert.equal(readTrackingIssue('accepted', '2020-01-01T00:00:00.000Z', throwingNow, null), null)
})

test('matching and live-trip screens guard the crash and keep a retry', () => {
  const picker = read('../app/pick-driver.tsx')
  const requested = read('../app/requested.tsx')
  const moments = read('../components/RiderMoments.tsx')
  const popup = read('../components/RiderMatchPopup.tsx')
  const layout = read('../app/_layout.tsx')
  const boundary = read('../components/FlowErrorBoundary.tsx')
  assert.match(picker, /sanitizeOnlineDrivers/)
  assert.match(picker, /rosterCard\(driver\)/)
  assert.doesNotMatch(picker, /tripCount\.toLocaleString/)
  assert.match(picker, /FlowErrorBoundary title="Pick a driver"/)
  assert.match(requested, /failedHoldPrompt/)
  assert.match(requested, /driverHeartbeatAt/)
  assert.match(requested, /function retryTracking\(\) \{\s*try \{/)
  assert.match(requested, /function openBilling\(\) \{\s*try \{/)
  assert.match(requested, /safeCounterpart\(person\)/)
  assert.match(requested, /FlowErrorBoundary title="Live ride"/)
  assert.match(moments, /try \{\s*failed = paymentFailedMoment/)
  assert.match(popup, /try \{\s*const prompt = failedHoldPrompt/)
  assert.match(layout, /<FlowErrorBoundary title="Driver matched">[\s\S]*<RiderMatchPopup \/>/)
  assert.match(layout, /<FlowErrorBoundary title="Ride updates">[\s\S]*<RiderMoments \/>/)
  assert.match(boundary, /Try again/)
  assert.match(boundary, /getDerivedStateFromError/)
})

test('selected pills stay compact chips inside the tab swipe region', () => {
  const button = read('../components/Button.tsx')
  const pager = read('../components/MainTabPager.tsx')
  const slots = read('../components/NearTermSlots.tsx')
  const home = read('../app/(tabs)/index.tsx')
  const schedule = read('../app/(tabs)/schedule.tsx')
  assert.match(button, /alignSelf: 'flex-start'/)
  assert.match(button, /flexGrow: 0/)
  assert.match(button, /flexShrink: 0/)
  assert.match(button, /backgroundColor: colors\.orange/)
  assert.doesNotMatch(button, /variant="chip"/)
  assert.match(button, /GlassButton/)
  assert.match(pager, /flexGrow: 0, alignSelf: 'stretch'/)
  assert.match(slots, /alignItems: 'flex-start'/)
  assert.match(slots, /<Pill key=\{option\.id\} label=\{option\.name\}/)
  assert.match(home, /Campus map/)
  assert.match(home, /Busy days/)
  assert.match(home, /style=\{styles\.chipScroller\}/)
  assert.match(home, /<Pill/)
  assert.match(schedule, /style=\{styles\.chipScroller\}/)
  assert.match(schedule, /alignItems: 'flex-start'/)
})
