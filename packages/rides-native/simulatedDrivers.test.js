import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { DOWNTOWN, STADIUM } from './places.js'
import { haversineMeters } from './riderShell.js'
import { fetchOnlineDrivers, requestDriverTrip } from './drivers.js'
import {
  BUSY_MARKER_FILL,
  SIMULATED_DRIVER_COUNT,
  SIMULATED_DRIVER_TITLE,
  SIMULATED_DRIVERS,
  SIMULATED_FLEET_BADGE,
  SIMULATED_FLEET_BOUNDS,
  busyCarSvg,
  isSimulatedDriverId,
  refuseSimulatedDriverTap,
  simulatedAlongTrackMeters,
  simulatedFleetAt,
  simulatedFleetPercent,
} from './simulatedDrivers.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function read(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf8')
}

function insideBounds(lat, lng) {
  return lat >= SIMULATED_FLEET_BOUNDS.minLat
    && lat <= SIMULATED_FLEET_BOUNDS.maxLat
    && lng >= SIMULATED_FLEET_BOUNDS.minLng
    && lng <= SIMULATED_FLEET_BOUNDS.maxLng
}

test('five simulated drivers are busy, not available, and not bookable', () => {
  assert.equal(SIMULATED_DRIVERS.length, SIMULATED_DRIVER_COUNT)
  assert.equal(SIMULATED_DRIVER_COUNT, 5)
  assert.equal(SIMULATED_DRIVER_TITLE, 'Busy')
  assert.equal(SIMULATED_FLEET_BADGE, 'Busy · already on a ride')
  assert.doesNotMatch(SIMULATED_FLEET_BADGE, /available/i)
  const ids = new Set()
  for (const driver of SIMULATED_DRIVERS) {
    assert.equal(ids.has(driver.id), false)
    ids.add(driver.id)
    assert.match(driver.id, /^sim-busy-/)
    assert.equal(driver.status, 'busy')
    assert.equal(driver.bookable, false)
    assert.equal(driver.online, false)
    assert.equal(isSimulatedDriverId(driver.id), true)
  }
  assert.equal(isSimulatedDriverId('11111111-1111-4111-8111-111111111111'), false)
})

test('simulated cars drive near Memorial Stadium, College Avenue, and campus', () => {
  const stadium = { lat: STADIUM.latitude, lng: STADIUM.longitude }
  const downtown = { lat: DOWNTOWN.latitude, lng: DOWNTOWN.longitude }
  const sikes = { lat: 34.6795, lng: -82.8374 }
  const byId = Object.fromEntries(SIMULATED_DRIVERS.map((driver) => [driver.id, driver]))

  const stadiumLoop = byId['sim-busy-stadium-loop']
  const college = byId['sim-busy-college-ave']
  const campus = byId['sim-busy-campus-core']
  const connector = byId['sim-busy-stadium-college']
  const downtownLoop = byId['sim-busy-downtown-block']

  const nearest = (driver, target) => Math.min(
    ...driver.route.map((point) => haversineMeters(point, target)),
  )

  assert.ok(nearest(stadiumLoop, stadium) < 400)
  assert.ok(nearest(college, downtown) < 350)
  assert.ok(college.route.some((point) => Math.abs(point.lng - -82.8373) < 0.001))
  assert.ok(nearest(campus, sikes) < 250)
  assert.ok(nearest(connector, stadium) < 400)
  assert.ok(nearest(connector, downtown) < 500)
  assert.ok(nearest(downtownLoop, downtown) < 300)
  assert.match(stadiumLoop.routeLabel, /Memorial Stadium/)
  assert.match(college.routeLabel, /College Avenue/)
  assert.match(campus.routeLabel, /Tillman Hall/)
  assert.match(campus.routeLabel, /Sikes Hall/)
})

test('simulated cars keep moving inside the Clemson campus box at driving speed', () => {
  const sampleCount = 40
  for (const driver of SIMULATED_DRIVERS) {
    for (let step = 0; step < sampleCount; step += 1) {
      const at = step * (driver.periodMs / sampleCount)
      const [car] = simulatedFleetAt(at).filter((row) => row.id === driver.id)
      assert.equal(car.status, 'busy')
      assert.equal(car.bookable, false)
      assert.equal(car.online, false)
      assert.equal(car.title, 'Busy')
      assert.match(car.description, /Already driving a rider/)
      assert.match(car.description, /Not available to request/)
      assert.equal(insideBounds(car.lat, car.lng), true)
    }
    const start = 1_000
    const later = start + 8_000
    const routeTotal = driver.route.slice(1).reduce((sum, point, index) => (
      sum + (haversineMeters(driver.route[index], point) || 0)
    ), 0)
    let traveled = simulatedAlongTrackMeters(driver.id, later) - simulatedAlongTrackMeters(driver.id, start)
    if (traveled < 0) traveled += routeTotal
    const mph = (traveled / 8) / 0.44704
    assert.ok(Math.abs(mph - driver.cruiseMph) < 1.5, `${driver.id} moved at ${mph} mph`)
    const early = simulatedFleetAt(start).find((row) => row.id === driver.id)
    const next = simulatedFleetAt(later).find((row) => row.id === driver.id)
    const moved = haversineMeters(early, next)
    assert.ok(moved > 20, `${driver.id} should be in motion`)
  }
})

test('a tap on a simulated driver books nothing and charges nothing', () => {
  const originalFetch = globalThis.fetch
  let called = false
  globalThis.fetch = async () => {
    called = true
    throw new Error('network is not part of a demo tap')
  }
  try {
    for (const driver of SIMULATED_DRIVERS) {
      const result = refuseSimulatedDriverTap(driver.id)
      assert.deepEqual(result, {
        booked: false,
        charged: false,
        notified: false,
        matched: false,
        status: 'busy',
      })
    }
    assert.equal(called, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('requesting a simulated driver does not call the payment endpoint', async () => {
  const originalFetch = globalThis.fetch
  let called = false
  globalThis.fetch = async () => {
    called = true
    throw new Error('stripe should not be called')
  }
  try {
    await assert.rejects(
      () => requestDriverTrip(
        { auth: { getSession: async () => ({ data: { session: null } }) } },
        { riderId: 'rider-1', driverId: SIMULATED_DRIVERS[0].id },
      ),
      /busy and cannot be requested/,
    )
    assert.equal(called, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('fetchOnlineDrivers excludes simulated ids even if a status row is online', async () => {
  const realId = '11111111-1111-4111-8111-111111111111'
  const simId = SIMULATED_DRIVERS[0].id
  let rpcIds = null
  const supabase = {
    rpc(_name, args) {
      rpcIds = args?.ids || []
      return Promise.resolve({
        data: rpcIds.map((id) => ({ profile_id: id })),
        error: null,
      })
    },
    from(table) {
      if (table === 'driver_status') {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({
                  data: [
                    { driver_id: simId, online: true, lat: 34.68, lng: -82.84 },
                    { driver_id: realId, online: true, lat: 34.68, lng: -82.84 },
                  ],
                  error: null,
                })
              },
            }
          },
        }
      }
      return {
        select() {
          return {
            in() {
              return Promise.resolve({ data: [], error: null })
            },
          }
        },
      }
    },
  }

  const mixed = await fetchOnlineDrivers(supabase)
  assert.equal(mixed.error, null)
  assert.deepEqual(mixed.drivers.map((driver) => driver.id), [realId])
  assert.equal(rpcIds.includes(simId), false)

  rpcIds = null
  const onlySim = {
    ...supabase,
    from(table) {
      if (table === 'driver_status') {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({
                  data: [{ driver_id: simId, online: true, lat: 34.68, lng: -82.84 }],
                  error: null,
                })
              },
            }
          },
        }
      }
      return supabase.from(table)
    },
  }
  const empty = await fetchOnlineDrivers(onlySim)
  assert.deepEqual(empty.drivers, [])
  assert.equal(rpcIds, null)
})

test('busy marker art is labeled Busy and is not the available orange pin', () => {
  const svg = busyCarSvg(90)
  assert.match(svg, />Busy</)
  assert.match(svg, new RegExp(BUSY_MARKER_FILL.replace('#', '#')))
  assert.equal(svg.includes('#F56600'), false)
  assert.equal(svg.includes('Available'), false)
})

test('preview layout keeps every demo car inside the map frame', () => {
  const fleet = simulatedFleetAt(12_000)
  for (const car of fleet) {
    const spot = simulatedFleetPercent(car.lat, car.lng)
    assert.ok(spot.left >= 8 && spot.left <= 92)
    assert.ok(spot.top >= 8 && spot.top <= 92)
  }
})

test('demo fleet source does not insert driver rows, charge cards, or notify', () => {
  const source = read('packages/rides-native/simulatedDrivers.js')
  assert.equal(source.includes('driver_status'), false)
  assert.equal(source.includes('supabase'), false)
  assert.equal(source.includes('stripe'), false)
  assert.equal(source.includes('notification'), false)
  assert.equal(source.includes('.insert('), false)
  assert.equal(source.includes('.upsert('), false)

  const drivers = read('packages/rides-native/drivers.js')
  assert.match(drivers, /isSimulatedDriverId/)
  assert.match(drivers, /busy and cannot be requested/)

  const home = read('src/screens/RiderHome.jsx')
  const nativeHome = read('apps/rider/app/index.tsx')
  assert.match(home, /showSimulatedFleet/)
  assert.match(nativeHome, /showSimulatedFleet/)

  const driverHome = read('src/screens/DriverHome.jsx')
  assert.equal(driverHome.includes('showSimulatedFleet'), false)
  assert.equal(driverHome.includes('simulatedDrivers'), false)

  const webMap = read('src/components/CampusMap.jsx')
  assert.match(webMap, /showSimulatedFleet = false/)
  assert.match(webMap, /refuseSimulatedDriverTap/)
  assert.match(webMap, /SIMULATED_FLEET_BADGE/)
})
