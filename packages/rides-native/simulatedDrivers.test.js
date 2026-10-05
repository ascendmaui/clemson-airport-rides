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
  DEMO_HIDE_RADIUS_M,
  DEMO_ORANGE,
  DEMO_PURPLE,
  SIMULATED_FLEET_BOUNDS,
  demoCarSvg,
  lerpHeading,
  portraitKind,
  visibleDemoCars,
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
  assert.equal(SIMULATED_DRIVER_COUNT, 12)
  assert.equal(SIMULATED_DRIVER_TITLE, 'Busy')
  assert.match(SIMULATED_FLEET_BADGE, /cannot be requested/i)
  assert.doesNotMatch(SIMULATED_FLEET_BADGE, /available to request/i)
  const ids = new Set()
  for (const driver of SIMULATED_DRIVERS) {
    assert.equal(ids.has(driver.id), false)
    ids.add(driver.id)
    assert.match(driver.id, /^sim-busy-/)
    assert.equal(driver.status, 'busy')
    assert.equal(driver.bookable, false)
    assert.equal(driver.online, false)
    assert.equal(driver.is_demo, true)
    assert.equal(driver.source, 'demo')
    assert.equal(driver.bookable, false)
    assert.equal(isSimulatedDriverId(driver.id), true)
  }
  const trucks = SIMULATED_DRIVERS.filter((driver) => driver.make === 'Ford' && driver.model === 'F-150')
  assert.deepEqual(trucks.map((driver) => driver.colorName), ['White', 'Orange', 'Purple'])
  const cyber = SIMULATED_DRIVERS.filter((driver) => driver.model === 'Cybertruck')
  assert.equal(cyber.length, 1)
  assert.equal(cyber[0].make, 'Tesla')
  assert.equal(cyber[0].bookable, false)
  assert.equal(cyber[0].is_demo, true)
  const luxury = ['BMW', 'Mercedes-Benz', 'Audi', 'Range Rover', 'Lexus', 'Porsche', 'Cadillac', 'Genesis']
  for (const make of luxury) assert.equal(SIMULATED_DRIVERS.some((driver) => driver.make === make), true)
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
      assert.match(car.title, /^[A-Z][a-z]+, /)
      assert.equal(car.is_demo, true)
      assert.match(car.description, /Not available to request/)
      assert.doesNotMatch(car.description, /self-driving|robotaxi/i)
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

test('demo marker art uses orange and purple tiger stripes and no university marks', () => {
  const svg = demoCarSvg({ heading: 90, body: 'suv', base: '#1A1A1A' })
  assert.match(svg, new RegExp(DEMO_ORANGE))
  assert.match(svg, new RegExp(DEMO_PURPLE))
  assert.equal(svg.includes('Available'), false)
  assert.equal(svg.includes('Clemson Tigers'), false)
  assert.equal(svg.includes('tiger paw'), false)
  assert.equal(/<text/i.test(svg), false)
  const truck = demoCarSvg({ heading: 0, body: 'truck', base: DEMO_ORANGE })
  const wedge = demoCarSvg({ heading: 0, body: 'cybertruck', base: '#C5C1B7' })
  assert.match(truck, /<rect /)
  assert.match(wedge, /<polygon /)
  assert.equal(lerpHeading(350, 10, 0.5), 0)
})

test('demo headshots match the shared roster and real drivers never receive one', () => {
  const roster = [
    ['Marcus', 'BMW', 'X5', 'demo-marcus'],
    ['Jenna', 'Mercedes-Benz', 'GLE', 'demo-jenna'],
    ['Darnell', 'Audi', 'Q7', 'demo-darnell'],
    ['Priya', 'Range Rover', 'Sport', 'demo-priya'],
    ['Carlos', 'Lexus', 'RX', 'demo-carlos'],
    ['Hannah', 'Porsche', 'Macan', 'demo-hannah'],
    ['Terrence', 'Cadillac', 'Escalade', 'demo-terrence'],
    ['Mei', 'Genesis', 'GV80', 'demo-mei'],
    ['Wade', 'Ford', 'F-150', 'demo-wade'],
    ['Tasha', 'Ford', 'F-150', 'demo-tasha'],
    ['Luis', 'Ford', 'F-150', 'demo-luis'],
    ['Brooke', 'Tesla', 'Cybertruck', 'demo-brooke'],
  ]
  assert.deepEqual(
    SIMULATED_DRIVERS.map((driver) => [driver.firstName, driver.make, driver.model, driver.headshotId]),
    roster,
  )
  const realInitials = portraitKind({ id: 'real-driver', name: 'Sam' })
  assert.equal(realInitials.kind, 'initials')
  assert.equal(realInitials.headshotId, null)
  assert.ok(realInitials.color === '#F56600' || realInitials.color === '#522D80')
  const realPhoto = portraitKind({ id: 'real-driver', name: 'Sam', avatarUrl: 'https://example.com/a.jpg' })
  assert.equal(realPhoto.kind, 'photo')
  assert.equal(realPhoto.headshotId, null)
  const demo = portraitKind({ id: 'sim-busy-cybertruck', headshotId: 'demo-brooke', avatarUrl: 'https://example.com/a.jpg' })
  assert.equal(demo.kind, 'demo')
  assert.equal(demo.headshotId, 'demo-brooke')
})

test('a real driver hides only the nearby demo car', () => {
  const fleet = simulatedFleetAt(12_000)
  const target = fleet[0]
  const hidden = visibleDemoCars(fleet, [{ id: 'real-1', lat: target.lat, lng: target.lng, online: true }])
  assert.equal(hidden.some((car) => car.id === target.id), false)
  assert.ok(hidden.length < fleet.length)
  assert.ok(hidden.length > 0)
  const far = visibleDemoCars(fleet, [{ id: 'real-2', lat: 34.5, lng: -82.5 }])
  assert.equal(far.length, fleet.length)
  assert.equal(DEMO_HIDE_RADIUS_M <= 400, true)
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
