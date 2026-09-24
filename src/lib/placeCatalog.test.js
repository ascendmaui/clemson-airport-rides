import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  hotCatalogPlaces,
  lookupCatalogPlace,
  searchCatalogPlaces,
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
