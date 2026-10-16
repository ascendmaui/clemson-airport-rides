/**
 * Regression: a place was priced as a GSP airport trip whenever its label
 * contained "Greenville" (likewise ATL / CLT / CHARLOTTE as substrings).
 * Prod quote 2026-10-16: "Old Greenville Highway, Clemson" at
 * 34.6813,-82.8205 returned airport GSP, $76.85. Airports are now decided by
 * coordinates near the terminal, an explicit airport id, or the airport's
 * exact own label; and catalog search no longer lists GSP for that street.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import handleQuote from '../server/endpoints/quoteFare.js'
import { AIRPORT_MATCH_RADIUS_M, AIRPORT_PLACES, airportCodeForPlace } from '../src/lib/scheduledRideModel.js'
import { searchCatalogPlaces } from '../src/lib/placeCatalog.js'

const QUIET = new Date('2026-10-21T15:00:00.000Z')
const COOPER = { label: 'Cooper Library', lat: 34.6765, lng: -82.8375 }
const OLD_GREENVILLE = { label: 'Old Greenville Highway, Clemson, South Carolina 29631', lat: 34.6813259, lng: -82.8204731 }
const GSP = AIRPORT_PLACES.find((row) => row.code === 'GSP')

function mockRes() {
  return {
    statusCode: 200,
    body: '',
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    end(payload) { this.body = payload == null ? '' : String(payload) },
  }
}

async function quote(body) {
  const res = mockRes()
  await handleQuote(
    { method: 'POST', headers: {}, body },
    res,
    { sb: null, user: null, now: QUIET, computeRoutes: async () => ({ error: 'offline in test' }) },
  )
  return { status: res.statusCode, json: JSON.parse(res.body) }
}

test('airportCodeForPlace: city names and substrings are not airports', () => {
  assert.equal(airportCodeForPlace(OLD_GREENVILLE), null)
  assert.equal(airportCodeForPlace({ label: 'Old Greenville Hwy, Clemson' }), null)
  assert.equal(airportCodeForPlace({ label: 'Greenville' }), null)
  assert.equal(airportCodeForPlace({ label: 'Atlantic Ave, Clemson', lat: 34.68, lng: -82.83 }), null)
  assert.equal(airportCodeForPlace({ label: 'Charlotte St, Clemson', lat: 34.68, lng: -82.83 }), null)
  assert.equal(airportCodeForPlace({ label: 'SALTY DOG CLT CAFE' }), null)
})

test('airportCodeForPlace: terminal coordinates, ids and exact airport labels are airports', () => {
  assert.equal(airportCodeForPlace({ label: 'Somewhere', lat: GSP.lat, lng: GSP.lng }), 'GSP')
  // ~1 km from the GSP pin is still the airport; ~3 km is not.
  assert.equal(airportCodeForPlace({ label: 'Terminal curb', lat: GSP.lat + 0.009, lng: GSP.lng }), 'GSP')
  assert.equal(airportCodeForPlace({ label: 'Greer', lat: GSP.lat + 0.027, lng: GSP.lng }), null)
  assert.ok(AIRPORT_MATCH_RADIUS_M >= 1000 && AIRPORT_MATCH_RADIUS_M <= 2000)
  for (const row of AIRPORT_PLACES) {
    assert.equal(airportCodeForPlace({ lat: row.lat, lng: row.lng }), row.code)
    assert.equal(airportCodeForPlace({ label: row.label }), row.code)
    assert.equal(airportCodeForPlace({ label: `${row.code} Airport` }), row.code)
    assert.equal(airportCodeForPlace({ code: row.code }), row.code)
    assert.equal(airportCodeForPlace({ kind: 'airport', id: row.code.toLowerCase(), label: 'x' }), row.code)
  }
})

test("quote: 'Old Greenville Highway, Clemson' at 34.6813,-82.8205 is a local ride", async () => {
  const { status, json } = await quote({
    pickupLabel: COOPER.label, pickupLat: COOPER.lat, pickupLng: COOPER.lng,
    dest: OLD_GREENVILLE.label, destLat: OLD_GREENVILLE.lat, destLng: OLD_GREENVILLE.lng,
  })
  assert.equal(status, 200)
  assert.equal(json.airport, null)
  assert.ok(json.fareCents > 0 && json.fareCents < 2000, `local fare, got ${json.fareCents}`)
})

test('quote: GSP still quotes as an airport', async () => {
  const { status, json } = await quote({
    pickupLabel: COOPER.label, pickupLat: COOPER.lat, pickupLng: COOPER.lng,
    dest: 'GSP Airport', destLat: GSP.lat, destLng: GSP.lng,
  })
  assert.equal(status, 200)
  assert.equal(json.airport, 'GSP')
  assert.ok(json.fareCents > 5000)
})

test('search: a street naming Greenville does not list GSP; GSP queries still do', () => {
  const ids = (q) => searchCatalogPlaces(q).map((row) => row.id)
  assert.ok(!ids('Old Greenville Hwy, Clemson').includes('gsp'))
  assert.ok(!ids('Old Greenville Highway').includes('gsp'))
  assert.equal(ids('GSP')[0], 'gsp')
  assert.ok(ids('Greenville-Spartanburg International').includes('gsp'))
  assert.ok(ids('greenville').includes('gsp'))
})
