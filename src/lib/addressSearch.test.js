import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  MIN_REMOTE_QUERY,
  SUGGEST_DEBOUNCE_MS,
  clearAddressCache,
  geoapifyAutocompleteUrl,
  parseGeoapifyResults,
  parsePhotonResults,
  remoteProvider,
  reverseLabel,
  suggestAddresses,
} from './addressSearch.js'
import { catalogStops, lookupCatalogPlace, searchCatalogPlaces } from './placeCatalog.js'
import { CLEMSON_STOPS } from './clemsonStops.js'
import { NEIGHBORHOODS } from './carpoolEngine.js'
import { airportCodeForPlace } from './scheduledRideModel.js'

const GEO = {
  results: [
    { place_id: 'a1', address_line1: '105 Sloan Street', address_line2: 'Clemson, SC 29631, United States of America', lat: 34.6839, lon: -82.8378 },
    { place_id: 'far', address_line1: '105 Sloan Street', address_line2: 'Portland, OR, United States of America', lat: 45.5, lon: -122.6 },
  ],
}
const PHOTON = {
  features: [
    { geometry: { coordinates: [-82.8378, 34.6839] }, properties: { osm_type: 'N', osm_id: 7, housenumber: '105', street: 'Sloan Street', city: 'Clemson', state: 'South Carolina', postcode: '29631', countrycode: 'US' } },
    { geometry: { coordinates: [2.35, 48.85] }, properties: { osm_id: 8, name: 'Paris', countrycode: 'FR' } },
  ],
}

function fakeFetch(routes) {
  const calls = []
  const impl = async (url) => {
    calls.push(url)
    for (const [needle, reply] of routes) {
      if (url.includes(needle)) {
        if (reply instanceof Error) throw reply
        return { ok: reply.ok ?? true, status: reply.status ?? 200, json: async () => reply.body }
      }
    }
    throw new Error(`unexpected ${url}`)
  }
  impl.calls = calls
  return impl
}

test('remote search waits for 3 characters and debounces 300 ms', async () => {
  assert.equal(MIN_REMOTE_QUERY, 3)
  assert.equal(SUGGEST_DEBOUNCE_MS, 300)
  const fetchImpl = fakeFetch([])
  const out = await suggestAddresses('cl', { apiKey: 'k', fetchImpl })
  assert.deepEqual(out, { provider: null, results: [] })
  assert.equal(fetchImpl.calls.length, 0)
})

test('Geoapify request is biased to Clemson and limited to the US', () => {
  const url = new URL(geoapifyAutocompleteUrl('105 sloan', 'test-key'))
  assert.equal(url.origin + url.pathname, 'https://api.geoapify.com/v1/geocode/autocomplete')
  assert.equal(url.searchParams.get('text'), '105 sloan')
  assert.equal(url.searchParams.get('filter'), 'countrycode:us')
  assert.equal(url.searchParams.get('bias'), 'proximity:-82.837,34.683')
  assert.equal(url.searchParams.get('format'), 'json')
  assert.equal(url.searchParams.get('apiKey'), 'test-key')
  assert.equal(remoteProvider('test-key'), 'geoapify')
  assert.equal(remoteProvider(''), 'photon')
})

test('Geoapify results become pins and far-away rows are dropped', () => {
  const rows = parseGeoapifyResults(GEO)
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0], { id: 'geoapify:a1', label: '105 Sloan Street, Clemson, SC 29631', lat: 34.6839, lng: -82.8378, kind: 'address', source: 'geoapify' })
  assert.deepEqual(parseGeoapifyResults(null), [])
})

test('Photon results keep US rows near the Upstate', () => {
  const rows = parsePhotonResults(PHOTON)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].label, '105 Sloan Street, Clemson, South Carolina 29631')
  assert.equal(rows[0].lat, 34.6839)
  assert.equal(rows[0].lng, -82.8378)
})

test('a key uses Geoapify; no key uses Photon', async () => {
  clearAddressCache()
  const geo = fakeFetch([['api.geoapify.com', { body: GEO }]])
  const a = await suggestAddresses('105 sloan', { apiKey: 'k', fetchImpl: geo })
  assert.equal(a.provider, 'geoapify')
  assert.equal(a.results.length, 1)
  assert.equal(geo.calls.length, 1)

  const photon = fakeFetch([['photon.komoot.io', { body: PHOTON }]])
  const b = await suggestAddresses('105 sloan', { apiKey: '', fetchImpl: photon })
  assert.equal(b.provider, 'photon')
  assert.match(photon.calls[0], /lat=34\.683&lon=-82\.837/)
})

test('a Geoapify failure falls back to Photon, and both failing returns no rows', async () => {
  clearAddressCache()
  const fallback = fakeFetch([['api.geoapify.com', { ok: false, status: 401, body: {} }], ['photon.komoot.io', { body: PHOTON }]])
  const a = await suggestAddresses('sloan street', { apiKey: 'bad', fetchImpl: fallback })
  assert.equal(a.provider, 'photon')
  assert.equal(a.results.length, 1)

  clearAddressCache()
  const down = fakeFetch([['api.geoapify.com', new Error('offline')], ['photon.komoot.io', new Error('offline')]])
  const b = await suggestAddresses('sloan street', { apiKey: 'k', fetchImpl: down })
  assert.deepEqual(b, { provider: null, results: [] })

  clearAddressCache()
  const none = await suggestAddresses('sloan street', { apiKey: '', fetchImpl: undefined })
  assert.deepEqual(none, { provider: null, results: [] })
})

test('reverse geocoding uses Geoapify, then Photon, then null', async () => {
  const geo = fakeFetch([['geocode/reverse', { body: { results: [{ address_line1: '105 Sloan Street', address_line2: 'Clemson, SC 29631, United States of America' }] } }]])
  assert.equal(await reverseLabel(34.6839, -82.8378, { apiKey: 'k', fetchImpl: geo }), '105 Sloan Street, Clemson, SC 29631')
  assert.match(geo.calls[0], /lat=34\.6839&lon=-82\.8378/)

  const photon = fakeFetch([['geocode/reverse', new Error('down')], ['photon.komoot.io/reverse', { body: PHOTON }]])
  assert.equal(await reverseLabel(34.6839, -82.8378, { apiKey: 'k', fetchImpl: photon }), '105 Sloan Street, Clemson, South Carolina 29631')

  const down = fakeFetch([['photon.komoot.io', new Error('down')]])
  assert.equal(await reverseLabel(34.6839, -82.8378, { apiKey: '', fetchImpl: down }), null)
  assert.equal(await reverseLabel('x', null, { fetchImpl: down }), null)
})

test('the Clemson catalog has 50+ new stops in the Upstate with unique ids', () => {
  assert.ok(CLEMSON_STOPS.length >= 50, `only ${CLEMSON_STOPS.length}`)
  const ids = catalogStops().map((row) => row.id)
  assert.equal(new Set(ids).size, ids.length)
  const labels = catalogStops().map((row) => row.label.toLowerCase())
  assert.equal(new Set(labels).size, labels.length)
  for (const row of CLEMSON_STOPS) {
    assert.ok(row.lat > 34.4 && row.lat < 35.0, `${row.id} lat ${row.lat}`)
    assert.ok(row.lng > -83.2 && row.lng < -82.4, `${row.id} lng ${row.lng}`)
    assert.ok(row.aliases.length > 0)
  }
  for (const kind of ['housing', 'parking', 'downtown', 'hotel', 'hospital', 'town']) {
    assert.ok(CLEMSON_STOPS.some((row) => row.kind === kind), `missing ${kind}`)
  }
})

test('new stops never look like an airport flat-rate trip', () => {
  for (const row of CLEMSON_STOPS) {
    assert.equal(airportCodeForPlace(row), null, row.label)
  }
})

test('new stops do not change existing pricing lookups', () => {
  for (const row of NEIGHBORHOODS) {
    assert.equal(lookupCatalogPlace(row.label)?.id, row.id, row.label)
  }
  assert.equal(searchCatalogPlaces('stadium')[0]?.id, 'memorial-stadium')
  assert.equal(searchCatalogPlaces('tillman')[0]?.id, 'tillman')
  assert.equal(searchCatalogPlaces('greek row')[0]?.id, 'greek-quad')
  assert.equal(searchCatalogPlaces('p4')[0]?.id, 'lot-p4')
  assert.equal(searchCatalogPlaces('hospital')[0]?.id, 'oconee-memorial')
  assert.equal(lookupCatalogPlace('Plaza One89')?.id, 'plaza-one89')
})

test('address fields no longer use the legacy Google Places Autocomplete', () => {
  for (const file of ['../components/AddressSuggest.jsx', '../components/PlacePicker.jsx', './currentPlace.js']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.doesNotMatch(src, /places\.Autocomplete|google\.maps\.Geocoder|useJsApiLoader/, file)
  }
  for (const file of ['../components/AddressSuggest.jsx', '../components/PlacePicker.jsx']) {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8')
    assert.match(src, /useAddressSuggestions/, file)
    assert.match(src, /AddressAttribution/, file)
  }
  const attribution = readFileSync(new URL('../components/AddressAttribution.jsx', import.meta.url), 'utf8')
  assert.match(attribution, /Powered by Geoapify/)
  assert.match(attribution, /OpenStreetMap contributors/)
})

test('the Docker build accepts the Geoapify key as a build arg', () => {
  // deploy-vps.yml must also pass VITE_GEOAPIFY_API_KEY=${{ secrets.VITE_GEOAPIFY_API_KEY }}
  // in build-args (workflow edits need a token with the workflow scope; see the PR).
  const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8')
  assert.match(dockerfile, /ARG VITE_GEOAPIFY_API_KEY/)
  assert.match(dockerfile, /VITE_GEOAPIFY_API_KEY=\$VITE_GEOAPIFY_API_KEY/)
})
