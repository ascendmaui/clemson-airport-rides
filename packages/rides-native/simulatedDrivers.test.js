import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { DOWNTOWN, STADIUM } from './places.js'
import { haversineMeters } from './riderShell.js'
import { fetchOnlineDrivers, requestDriverTrip } from './drivers.js'
import {
  SEARCH_DEMO_CYCLE_MS,
  SEARCH_MAP_DELTA_END,
  SEARCH_MAP_DELTA_START,
  SEARCH_MAP_ZOOM_MS,
  searchingDemoPair,
  searchingDemoRanked,
  searchMapRegion,
} from './searchPreview.js'
import {
  BUSY_MARKER_FILL,
  SIMULATED_DRIVER_COUNT,
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

test('demo drivers are busy, not available, and not bookable', () => {
  assert.equal(SIMULATED_DRIVERS.length, SIMULATED_DRIVER_COUNT)
  assert.equal(SIMULATED_DRIVER_COUNT, 12)
  assert.equal(SIMULATED_FLEET_BADGE, 'Preview cars')
  assert.doesNotMatch(SIMULATED_FLEET_BADGE, /available/i)
  const ids = new Set()
  for (const driver of SIMULATED_DRIVERS) {
    assert.equal(ids.has(driver.id), false)
    ids.add(driver.id)
    assert.match(driver.id, /^demo-/)
    assert.equal(driver.status, 'busy')
    assert.equal(driver.bookable, false)
    assert.equal(driver.online, false)
    assert.equal(driver.isDemo, true)
    assert.equal(isSimulatedDriverId(driver.id), true)
    assert.match(driver.photoSmall, /^\/demo-drivers\//)
  }
  assert.equal(isSimulatedDriverId('11111111-1111-4111-8111-111111111111'), false)
  assert.equal(isSimulatedDriverId('sim-busy-legacy'), true)
})

test('simulated cars drive near Memorial Stadium, College Avenue, and campus', () => {
  const stadium = { lat: STADIUM.latitude, lng: STADIUM.longitude }
  const downtown = { lat: DOWNTOWN.latitude, lng: DOWNTOWN.longitude }
  const sikes = { lat: 34.6795, lng: -82.8374 }
  const byId = Object.fromEntries(SIMULATED_DRIVERS.map((driver) => [driver.id, driver]))

  const stadiumLoop = byId['demo-marcus']
  const college = byId['demo-jenna']
  const campus = byId['demo-darnell']
  const connector = byId['demo-priya']
  const downtownLoop = byId['demo-carlos']

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
      assert.equal(car.title, driver.firstName)
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

test('marker art is a car silhouette in orange and purple', () => {
  const svg = busyCarSvg(90, { body: 'suv', livery: 'tiger' })
  assert.match(svg, /<svg/)
  assert.match(svg, /#F56600/)
  assert.match(svg, /#522D80/)
  assert.equal(svg.includes('Available'), false)
  assert.equal(BUSY_MARKER_FILL, '#522D80')
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
  const motion = read('src/components/FleetMotion.jsx')
  assert.match(webMap, /showSimulatedFleet = false/)
  assert.match(motion, /refuseSimulatedDriverTap/)
  assert.match(webMap, /SIMULATED_FLEET_BADGE/)
})

test('loaded web map builds the live driver marker from busyCarSvg', () => {
  const webMap = read('src/components/CampusMap.jsx')
  assert.match(webMap, /busyCarSvg/)
  assert.match(webMap, /function busyCarIcon\(heading\)/)
  assert.match(webMap, /busyCarSvg\(heading\)/)
  assert.match(webMap, /busyCarIcon\(Number\(driverHeading\)\)/)
  const fnAt = webMap.indexOf('function busyCarIcon(heading)')
  const callAt = webMap.indexOf('busyCarIcon(Number(driverHeading))')
  assert.ok(fnAt > 0 && callAt > fnAt)
})

test('searching preview ranks demo cars without making them available', async () => {
  const pickup = { lat: 34.6787, lng: -82.8466 }
  const ranked = searchingDemoRanked(1_000_000, pickup)
  assert.equal(ranked.length, SIMULATED_DRIVER_COUNT)
  for (let index = 0; index < ranked.length; index += 1) {
    const card = ranked[index]
    if (index > 0) assert.ok(card.previewMeters >= ranked[index - 1].previewMeters)
    assert.equal(card.previewRank, index + 1)
    assert.equal(card.isDemo, true)
    assert.equal(card.source, 'demo')
    assert.equal(card.bookable, false)
    assert.equal(card.online, false)
    assert.equal(card.matched, false)
    assert.equal(card.affectsAvailability, false)
    assert.equal(card.affectsEta, false)
    assert.equal(card.affectsPrice, false)
    assert.equal(card.etaMin, null)
    assert.equal(card.priceCents, null)
    assert.equal(isSimulatedDriverId(card.id), true)
    await assert.rejects(
      () => requestDriverTrip({}, { riderId: 'rider-1', driverId: card.id }),
      /cannot be requested/,
    )
  }
  assert.equal(ranked.filter((card) => card.body === 'wedge').length, 1)
  const labels = ranked.map((card) => card.vehicleLabel).join('\n')
  const banned = new RegExp(
    ['te' + 'sla', 'model' + ' 3', 'self' + '-driving', 'robo' + 'taxi'].join('|'),
    'i',
  )
  assert.equal(banned.test(labels), false)

  const pair = searchingDemoPair(0, 5_000, pickup)
  assert.equal(pair.current.previewRank, 1)
  assert.equal(pair.next.previewRank, 2)
  assert.equal(pair.current.previewMeters <= pair.next.previewMeters, true)
  const advanced = searchingDemoPair(SEARCH_DEMO_CYCLE_MS, 5_000, pickup)
  assert.equal(advanced.current.previewRank, 2)
  assert.equal(advanced.next.previewRank, 3)
})

test('search map zoom widens over Clemson without speeding the fleet up', () => {
  const start = searchMapRegion(0)
  const mid = searchMapRegion(SEARCH_MAP_ZOOM_MS / 2)
  const end = searchMapRegion(SEARCH_MAP_ZOOM_MS)
  assert.equal(start.latitudeDelta, SEARCH_MAP_DELTA_START)
  assert.ok(mid.latitudeDelta > start.latitudeDelta)
  assert.ok(end.latitudeDelta > mid.latitudeDelta)
  assert.equal(end.latitudeDelta, SEARCH_MAP_DELTA_END)
  assert.equal(start.latitude, end.latitude)
  assert.equal(start.longitude, end.longitude)
  assert.equal(end.progress, 1)

  const helper = read('packages/rides-native/searchPreview.js')
  assert.equal(helper.includes('supabase'), false)
  assert.equal(helper.includes('stripe'), false)
  assert.equal(helper.includes('.insert('), false)
  assert.equal(helper.includes('cruiseMph'), false)

  const nativeMap = read('apps/rider/components/CampusMap.native.tsx')
  assert.match(nativeMap, /useSimulatedFleet\(showSimulatedFleet \|\| searchMotion\)/)
  assert.match(nativeMap, /refuseSimulatedDriverTap\(car\.id\)/)
  assert.equal(nativeMap.includes('SIMULATED_FLEET_TICK_MS'), false)

  const requested = read('apps/rider/app/requested.tsx')
  assert.match(requested, /searchMotion=\{searchingMap\}/)
  assert.match(requested, /readableSteps/)
  assert.match(requested, /SearchDemoCycle/)
  assert.match(requested, /RIDER_SEARCH_MOTION_COPY/)
  assert.match(requested, /label="Schedule"/)
  assert.match(requested, /pathname: '\/schedule'/)
  assert.equal(requested.includes('Airport holds use the 25% Stripe deposit'), false)
  assert.equal(requested.includes('25%'), false)
  assert.equal(/Stripe deposit/i.test(requested), false)
  assert.equal(requested.includes('Only a real driver accept'), false)
  assert.equal(requested.includes('The deposit shows up'), false)

  const card = read('apps/rider/components/SearchDemoCycle.tsx')
  assert.equal(/requestDriverTrip|priceCents|etaMin|Stripe|deposit/i.test(card), false)

  const picker = read('apps/rider/app/pick-driver.tsx')
  assert.equal(picker.includes('searchMotion'), false)
  assert.equal(picker.includes('SearchDemoCycle'), false)

  const driverTrip = read('apps/driver/app/trip.tsx')
  assert.equal(driverTrip.includes('readableSteps'), false)
  assert.equal(driverTrip.includes('searchMotion'), false)

  const webRequested = read('src/screens/Requested.jsx')
  assert.equal(webRequested.includes('SearchDemoCycle'), false)
  assert.equal(webRequested.includes('searchMotion'), false)
  assert.match(webRequested, /SEARCH_PREVIEW_COPY/)
})
