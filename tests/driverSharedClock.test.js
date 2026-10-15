import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createSecondClock } from '../apps/driver/lib/sharedClock.ts'
import { TRIP_FALLBACK_POLL_MS, tripPollTick } from '../apps/driver/lib/tripPoll.ts'
import { sameCoord, sameRouteProps } from '../apps/driver/lib/markerRedraw.ts'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

function fakeTimers() {
  const timers = new Map()
  let next = 1
  return {
    timers,
    setTimer: (fn, ms) => { const id = next++; timers.set(id, { fn, ms }); return id },
    clearTimer: (id) => { timers.delete(id) },
    fire: () => { for (const t of [...timers.values()]) t.fn() },
  }
}

test('shared clock: many subscribers share one interval, which stops with the last one', () => {
  const t = fakeTimers()
  let now = 1000
  const clock = createSecondClock({ read: () => now, setTimer: t.setTimer, clearTimer: t.clearTimer })
  assert.equal(t.timers.size, 0)
  const seen = []
  const offs = [1, 2, 3].map((n) => clock.subscribe(() => seen.push(n)))
  assert.equal(t.timers.size, 1, 'three cards, one timer')
  assert.equal([...t.timers.values()][0].ms, 1000)
  now = 2000
  t.fire()
  assert.equal(clock.now(), 2000)
  assert.deepEqual(seen, [1, 2, 3])
  offs[0](); offs[1]()
  assert.equal(t.timers.size, 1)
  offs[2]()
  assert.equal(t.timers.size, 0)
  assert.equal(clock.listenerCount(), 0)
})

test('shared clock: snapshot is stable between ticks and fresh on first subscribe', () => {
  const t = fakeTimers()
  let now = 5
  const clock = createSecondClock({ read: () => now, setTimer: t.setTimer, clearTimer: t.clearTimer })
  now = 50
  const off = clock.subscribe(() => {})
  assert.equal(clock.now(), 50)
  now = 60
  assert.equal(clock.now(), 50, 'unchanged until the next tick (useSyncExternalStore needs a stable snapshot)')
  off()
})

test('shared clock: a throwing listener does not stop the others', () => {
  const t = fakeTimers()
  const clock = createSecondClock({ read: () => 1, setTimer: t.setTimer, clearTimer: t.clearTimer })
  let ok = 0
  const warn = console.warn
  console.warn = () => {}
  try {
    clock.subscribe(() => { throw new Error('boom') })
    clock.subscribe(() => { ok += 1 })
    t.fire()
  } finally { console.warn = warn }
  assert.equal(ok, 1)
})

test('per-component 1s intervals are gone from driver countdowns', () => {
  for (const file of ['apps/driver/components/WaitTimer.tsx', 'apps/driver/components/DashcamCard.tsx']) {
    const src = read(file)
    assert.doesNotMatch(src, /setInterval\(/, file)
    assert.match(src, /useSecondClock\(/, file)
  }
  const home = read('apps/driver/app/(tabs)/index.tsx')
  assert.doesNotMatch(home, /setTick\(/)
  assert.match(home, /const tick = useSecondClock\(\)/)
  const trip = read('apps/driver/app/trip.tsx')
  assert.doesNotMatch(trip, /setInterval\(tick, 1000\)/)
})

test('trip screen runs a single fallback poll', () => {
  const trip = read('apps/driver/app/trip.tsx')
  assert.equal((trip.match(/setInterval\([^\n]*5000\)/g) ?? []).length, 0)
  assert.equal((trip.match(/TRIP_FALLBACK_POLL_MS\)/g) ?? []).length, 1)
  assert.equal(TRIP_FALLBACK_POLL_MS, 5000)
})

test('trip poll tick: trip always (heartbeat), rider fix only in the foreground', () => {
  const calls = []
  tripPollTick('active', () => calls.push('trip'), () => calls.push('rider'))
  tripPollTick('background', () => calls.push('trip'), () => calls.push('rider'))
  tripPollTick('active', () => calls.push('trip'), null)
  assert.deepEqual(calls, ['trip', 'rider', 'trip', 'trip'])
})

test('route map memo: re-render only when a pin moves', () => {
  const p = { latitude: 34.68, longitude: -82.83 }
  assert.equal(sameCoord(null, undefined), true)
  assert.equal(sameCoord(p, null), false)
  assert.equal(sameCoord(p, { ...p }), true)
  assert.equal(sameRouteProps({ driver: { ...p }, pickup: p, dropoff: null }, { driver: { ...p }, pickup: { ...p }, dropoff: null }), true)
  assert.equal(sameRouteProps({ driver: p, pickup: p, dropoff: null }, { driver: { ...p, latitude: 34.7 }, pickup: p, dropoff: null }), false)
  for (const file of ['apps/driver/components/OfferRouteMap.tsx', 'apps/driver/components/OfferRouteMap.native.tsx']) {
    assert.match(read(file), /export const OfferRouteMap = memo\(OfferRouteMapView, sameRouteProps\)/, file)
  }
})
