import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  hotCatalogPlaces,
  lookupCatalogPlace,
  searchCatalogPlaces,
  placeFromStop,
} from './placeCatalog.js'

function campusSpotLabels() {
  const source = readFileSync(new URL('./profiles.js', import.meta.url), 'utf8')
  const start = source.indexOf('export const CAMPUS_SPOTS = [')
  const end = source.indexOf(']', start)
  const body = source.slice(start, end)
  return [...body.matchAll(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g)].map((match) => match[0].slice(1, -1))
}

test('every CAMPUS_SPOTS label resolves to a coordinate', () => {
  const labels = campusSpotLabels()
  assert.ok(labels.length >= 20)
  for (const label of labels) {
    const found = lookupCatalogPlace(label)
    assert.ok(found, label)
    assert.equal(Number.isFinite(found.lat), true, label)
    assert.equal(Number.isFinite(found.lng), true, label)
  }
})

test('search finds campus neighborhoods and airports without a Maps key', () => {
  assert.equal(lookupCatalogPlace('Grand Mark')?.id, 'grand-marc')
  assert.equal(lookupCatalogPlace('Downtown / College Ave')?.id, 'college-ave')
  assert.equal(lookupCatalogPlace("Tiger Town Tavern (Triple T's)")?.id, 'tiger-town')
  assert.equal(lookupCatalogPlace('Memorial Stadium · Lot 5')?.id, 'memorial-stadium')
  assert.equal(lookupCatalogPlace('GSP Airport')?.id, 'gsp')
  assert.equal(lookupCatalogPlace('CLT')?.id, 'clt')
  assert.equal(lookupCatalogPlace('Sikes Hall')?.id, 'sikes')
  assert.equal(searchCatalogPlaces('stadium')[0]?.id, 'memorial-stadium')
  assert.equal(searchCatalogPlaces('gsp')[0]?.id, 'gsp')
  assert.equal(searchCatalogPlaces('').length, 0)
  assert.equal(lookupCatalogPlace('not a real stop'), null)
  assert.equal(hotCatalogPlaces().some((row) => row.id === 'gsp'), true)
  assert.equal(hotCatalogPlaces().some((row) => row.id === 'grand-marc'), true)
})

test('catalog edges: missing inputs, short strings, and alias ranking', () => {
  // Empty or short queries
  assert.equal(searchCatalogPlaces(null).length, 0)
  assert.equal(searchCatalogPlaces(undefined).length, 0)
  assert.equal(searchCatalogPlaces('a').length, 0) // < 2 chars
  
  // lookupCatalogPlace null/empty
  assert.equal(lookupCatalogPlace(null), null)
  assert.equal(lookupCatalogPlace(''), null)
  
  // Rank: exact match should come before prefix match
  // e.g. "Sikes" matches "Sikes Hall" alias "sikes" exact.
  const sikesRes = searchCatalogPlaces('sikes')
  assert.equal(sikesRes[0].id, 'sikes')
  
  // lookupCatalogPlace alias matching with suffixes
  // "GSP Airport · Terminal 2" works because "gsp airport" length >= 4
  assert.equal(lookupCatalogPlace('GSP Airport · Terminal 2')?.id, 'gsp')
  
  // But "GSP · Term" fails because "gsp" length < 4
  assert.equal(lookupCatalogPlace('GSP · Terminal 2'), null)
})

test('placeFromStop converts catalog row to simple coordinate object', () => {
  assert.equal(placeFromStop(null), null)
  const stop = { id: 'test', label: 'L', lat: 1, lng: 2, kind: 'campus', aliases: [] }
  assert.deepEqual(placeFromStop(stop), { label: 'L', lat: 1, lng: 2 })
})

test('placeFromCoordinates keeps a GPS fix as the pickup place', async () => {
  const { placeFromCoordinates } = await import('./currentPlace.js')
  assert.deepEqual(placeFromCoordinates(34.68, -82.84, '  Bowman '), {
    label: 'Bowman',
    lat: 34.68,
    lng: -82.84,
  })
  assert.deepEqual(placeFromCoordinates('34.1', '-82.2', ''), {
    label: 'Current location',
    lat: 34.1,
    lng: -82.2,
  })
  assert.equal(placeFromCoordinates('north', -82, 'Here'), null)
  assert.equal(placeFromCoordinates(null, -82, 'Here'), null)
  assert.equal(placeFromCoordinates('', '0', 'Here'), null)
})

test('reverseGeocodeLabel uses the GPS label when the geocoder never answers', async () => {
  const { reverseGeocodeLabel } = await import('./currentPlace.js')
  const previous = globalThis.window
  globalThis.window = {
    google: {
      maps: {
        Geocoder: class {
          geocode() {}
        },
      },
    },
  }
  try {
    const label = await reverseGeocodeLabel(34.6834, -82.8371)
    assert.equal(label, 'Current location (34.6834, -82.8371)')
  } finally {
    if (previous === undefined) delete globalThis.window
    else globalThis.window = previous
  }
})

test('finiteCoordinate treats a blank pin as missing', async () => {
  const { finiteCoordinate } = await import('./currentPlace.js')
  assert.equal(finiteCoordinate(''), null)
  assert.equal(finiteCoordinate('   '), null)
  assert.equal(finiteCoordinate(null), null)
  assert.equal(finiteCoordinate('north'), null)
  assert.equal(finiteCoordinate('0'), 0)
  assert.equal(finiteCoordinate(' 34.68 '), 34.68)
})
