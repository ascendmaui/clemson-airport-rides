import assert from 'node:assert/strict'
import test from 'node:test'
import { navigationLinks } from './mapsLink.js'

test('directions urls use coordinates when the stop has them', () => {
  const links = navigationLinks({ latitude: 34.6788, longitude: -82.843, label: 'Memorial Stadium' })
  assert.match(links.apple, /^http:\/\/maps\.apple\.com\/\?daddr=34\.6788,-82\.843/)
  assert.match(links.apple, /dirflg=d/)
  assert.match(links.google, /destination=34\.6788,-82\.843/)
  assert.match(links.google, /travelmode=driving/)
  assert.equal(links.hasPoint, true)
})

test('a label-only stop still opens a search', () => {
  const links = navigationLinks({ label: 'Sikes Hall' })
  assert.match(links.apple, /maps\.apple\.com\/\?q=Sikes%20Hall/)
  assert.match(links.google, /destination=Sikes%20Hall/)
  assert.equal(links.hasPoint, false)
})
