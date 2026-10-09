import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
  return readFileSync(path.join(root, rel), 'utf8')
}

test('Stop shift and the map type control share the driver header', () => {
  const header = read('src/components/DriverDeskHeader.jsx')
  const home = read('src/screens/DriverHome.jsx')
  assert.match(header, /className="driver-desk-header"/)
  assert.match(header, /<MapTypeSelect/)
  assert.match(header, /<DriverShiftControl/)
  const mapAt = header.indexOf('<MapTypeSelect')
  const stopAt = header.indexOf('<DriverShiftControl')
  assert.ok(mapAt > 0 && mapAt < stopAt)
  assert.match(header, /showMapType \?/)
  assert.match(header, /showShift \?/)
  assert.match(home, /<DriverDeskHeader/)
  assert.match(home, /showMapType=\{!activeTrip\}/)
  assert.match(home, /showShift=\{Boolean\(shownOffer \|\| activeTrip\)\}/)
  assert.doesNotMatch(home, /showMapTypeControl/)
})

test('the driver map does not float a map-type layer over Stop shift', () => {
  const map = read('src/components/CampusMap.jsx')
  const css = read('src/index.css')
  assert.doesNotMatch(map, /zIndex:\s*1000/)
  assert.match(map, /zIndex:\s*0/)
  assert.match(map, /top:\s*10,\s*right:\s*10,\s*zIndex:\s*2/)
  assert.doesNotMatch(map, /bottom:\s*0,\s*zIndex/)
  assert.match(css, /\.driver-desk-header\s*\{[^}]*z-index:\s*40/s)
  assert.match(css, /\.driver-desk-header\s*\{[^}]*display:\s*flex/s)
  assert.match(css, /\.driver-desk-header \.driver-shift--compact\s*\{[^}]*flex:\s*0 0 auto/s)
})
