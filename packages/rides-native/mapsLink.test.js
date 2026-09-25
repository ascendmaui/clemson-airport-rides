import assert from 'node:assert/strict'
import test from 'node:test'
import { navigationLinks } from './mapsLink.js'

test('directions urls use coordinates when the stop has them', () => {
  const links = navigationLinks({ latitude: 34.6788, longitude: -82.843, label: 'Memorial Stadium' })
  assert.match(links.apple, /^http:\/\/maps\.apple\.com\/\?daddr=34\.6788,-82\.843/)
  assert.match(links.apple, /dirflg=d/)
  assert.match(links.apple, /q=Memorial%20Stadium/)
  assert.match(links.google, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=34\.6788,-82\.843&travelmode=driving$/)
  assert.equal(links.hasPoint, true)
})

test('a label-only stop still opens a search', () => {
  const links = navigationLinks({ label: 'Sikes Hall' })
  assert.equal(links.apple, 'http://maps.apple.com/?q=Sikes%20Hall')
  assert.equal(links.google, 'https://www.google.com/maps/dir/?api=1&destination=Sikes%20Hall&travelmode=driving')
  assert.equal(links.hasPoint, false)
})

test('string coordinates are parsed into numeric coordinates', () => {
  const links = navigationLinks({ latitude: '34.6788', longitude: '-82.843', label: 'Downtown Clemson' })
  assert.match(links.apple, /^http:\/\/maps\.apple\.com\/\?daddr=34\.6788,-82\.843/)
  assert.match(links.google, /destination=34\.6788,-82\.843/)
  assert.equal(links.hasPoint, true)
})

test('zero coordinates (0, 0) are treated as valid points', () => {
  const links = navigationLinks({ latitude: 0, longitude: 0, label: 'Prime Meridian' })
  assert.match(links.apple, /^http:\/\/maps\.apple\.com\/\?daddr=0,0/)
  assert.match(links.google, /destination=0,0/)
  assert.equal(links.hasPoint, true)
})

test('no arguments or empty options default to Destination label and no point', () => {
  const defaultLinks = navigationLinks()
  assert.equal(defaultLinks.hasPoint, false)
  assert.equal(defaultLinks.apple, 'http://maps.apple.com/?q=Destination')
  assert.equal(defaultLinks.google, 'https://www.google.com/maps/dir/?api=1&destination=Destination&travelmode=driving')

  const emptyLinks = navigationLinks({})
  assert.equal(emptyLinks.hasPoint, false)
  assert.equal(emptyLinks.apple, 'http://maps.apple.com/?q=Destination')
  assert.equal(emptyLinks.google, 'https://www.google.com/maps/dir/?api=1&destination=Destination&travelmode=driving')
})

test('coordinates without label fall back to Destination query in Apple Maps', () => {
  const links = navigationLinks({ latitude: 34.6788, longitude: -82.843 })
  assert.equal(links.hasPoint, true)
  assert.match(links.apple, /q=Destination/)
  assert.match(links.apple, /daddr=34\.6788,-82\.843/)
  assert.equal(links.google, 'https://www.google.com/maps/dir/?api=1&destination=34.6788,-82.843&travelmode=driving')
})

test('label whitespace is trimmed and whitespace-only labels fall back to Destination', () => {
  const padded = navigationLinks({ label: '   Bowman Field   ' })
  assert.equal(padded.hasPoint, false)
  assert.equal(padded.apple, 'http://maps.apple.com/?q=Bowman%20Field')
  assert.equal(padded.google, 'https://www.google.com/maps/dir/?api=1&destination=Bowman%20Field&travelmode=driving')

  const blank = navigationLinks({ label: '   \t\n   ' })
  assert.equal(blank.hasPoint, false)
  assert.equal(blank.apple, 'http://maps.apple.com/?q=Destination')
  assert.equal(blank.google, 'https://www.google.com/maps/dir/?api=1&destination=Destination&travelmode=driving')
})

test('special characters and non-string labels are safely encoded', () => {
  const special = navigationLinks({
    latitude: 34.6788,
    longitude: -82.843,
    label: 'P&A Hall / Room #101? 🐅',
  })
  const expectedQuery = encodeURIComponent('P&A Hall / Room #101? 🐅')
  assert.match(special.apple, new RegExp(`q=${expectedQuery}`))

  const numericLabel = navigationLinks({ label: 12345 })
  assert.equal(numericLabel.apple, 'http://maps.apple.com/?q=12345')
  assert.equal(numericLabel.google, 'https://www.google.com/maps/dir/?api=1&destination=12345&travelmode=driving')
})

test('partial coordinates (one present, one missing) fall back to label-only query', () => {
  const onlyLat = navigationLinks({ latitude: 34.6788, longitude: undefined, label: 'Tillman Hall' })
  assert.equal(onlyLat.hasPoint, false)
  assert.equal(onlyLat.apple, 'http://maps.apple.com/?q=Tillman%20Hall')
  assert.equal(onlyLat.google, 'https://www.google.com/maps/dir/?api=1&destination=Tillman%20Hall&travelmode=driving')

  const onlyLng = navigationLinks({ latitude: undefined, longitude: -82.843, label: 'Tillman Hall' })
  assert.equal(onlyLng.hasPoint, false)
  assert.equal(onlyLng.apple, 'http://maps.apple.com/?q=Tillman%20Hall')
  assert.equal(onlyLng.google, 'https://www.google.com/maps/dir/?api=1&destination=Tillman%20Hall&travelmode=driving')
})

test('non-finite coordinates fall back to label-only query', () => {
  assert.equal(navigationLinks({ latitude: NaN, longitude: -82.843, label: 'Spot' }).hasPoint, false)
  assert.equal(navigationLinks({ latitude: Infinity, longitude: -82.843, label: 'Spot' }).hasPoint, false)
  assert.equal(navigationLinks({ latitude: -Infinity, longitude: -82.843, label: 'Spot' }).hasPoint, false)
  assert.equal(navigationLinks({ latitude: 'invalid_lat', longitude: -82.843, label: 'Spot' }).hasPoint, false)
  assert.equal(navigationLinks({ latitude: 34.6788, longitude: 'invalid_lng', label: 'Spot' }).hasPoint, false)
})

test('documented quirks and potential bugs in current implementation', () => {
  // BUG?: navigationLinks(null) throws TypeError because default parameter only covers undefined
  assert.throws(
    () => navigationLinks(null),
    TypeError,
  )

  // BUG?: coord(null) returns 0 instead of null because Number(null) === 0, so null coordinates produce hasPoint: true at (0, 0)
  const nullCoords = navigationLinks({ latitude: null, longitude: null, label: 'Null Island' })
  assert.equal(nullCoords.hasPoint, true)
  assert.match(nullCoords.apple, /daddr=0,0/)
  assert.match(nullCoords.google, /destination=0,0/)

  // BUG?: coord('') returns 0 instead of null because Number('') === 0
  const emptyStrCoords = navigationLinks({ latitude: '', longitude: '', label: 'Empty Strings' })
  assert.equal(emptyStrCoords.hasPoint, true)
  assert.match(emptyStrCoords.apple, /daddr=0,0/)
  assert.match(emptyStrCoords.google, /destination=0,0/)

  // BUG?: coord(false) returns 0 instead of null because Number(false) === 0
  const boolCoords = navigationLinks({ latitude: false, longitude: false, label: 'Booleans' })
  assert.equal(boolCoords.hasPoint, true)
  assert.match(boolCoords.apple, /daddr=0,0/)
  assert.match(boolCoords.google, /destination=0,0/)

  // BUG?: coord does not validate geographic latitude (-90..90) or longitude (-180..180) bounds
  const outOfBounds = navigationLinks({ latitude: 999, longitude: 999, label: 'Out of bounds' })
  assert.equal(outOfBounds.hasPoint, true)
  assert.match(outOfBounds.apple, /daddr=999,999/)
  assert.match(outOfBounds.google, /destination=999,999/)

  // BUG?: Apple Maps URL uses insecure http:// protocol instead of https://
  const sample = navigationLinks({ label: 'Campus' })
  assert.match(sample.apple, /^http:\/\/maps\.apple\.com\//)
})
