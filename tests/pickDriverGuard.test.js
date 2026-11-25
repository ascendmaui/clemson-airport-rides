import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { renderPickerDriverList } from '../apps/rider/lib/driverFields.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const validDriver = {
  id: 'drv-1',
  name: 'Mei',
  vehicleLabel: 'Blue Kia',
  plate: 'ABC123',
  online: true,
  lat: 34.679,
  lng: -82.843,
  ratingAvg: 4.9,
  ratingCount: 12,
  comfortClass: false,
  priorityMode: false,
  standing: 'good',
}

test('pick-driver renders with [null, {}, validDriver] without throwing', () => {
  const pickup = { lat: 34.6788, lng: -82.843 }
  let cards = []
  assert.doesNotThrow(() => {
    cards = renderPickerDriverList([null, {}, validDriver], pickup, ['drv-1'])
  })
  assert.equal(cards.length, 1)
  assert.equal(cards[0].id, 'drv-1')
  assert.equal(cards[0].name, 'Mei')
  assert.equal(cards[0].vehicleLabel, 'Blue Kia')
  assert.equal(cards[0].saved, true)
  assert.equal(cards[0].online, true)
  assert.match(cards[0].eta, /min/)
  assert.match(cards[0].ratingLabel, /4\.9/)
})

test('a driver row that throws while it is read becomes a safe card or is dropped', () => {
  const throwingId = {}
  Object.defineProperty(throwingId, 'id', { get() { throw new TypeError('id') } })
  const throwingName = {
    id: 'drv-bad',
    online: true,
  }
  Object.defineProperty(throwingName, 'name', { get() { throw new TypeError('name') } })
  Object.defineProperty(throwingName, 'ratingAvg', { get() { throw new TypeError('rating') } })
  let cards = []
  assert.doesNotThrow(() => {
    cards = renderPickerDriverList([null, {}, throwingId, throwingName, validDriver], { lat: 34.68, lng: -82.84 })
  })
  assert.deepEqual(cards.map((card) => card.id), ['drv-bad', 'drv-1'])
  assert.equal(cards[0].name, 'Driver')
  assert.equal(cards[1].name, 'Mei')
})

test('the picker list is null-safe and wrapped in a branded Try again boundary', () => {
  const screen = readFileSync(path.join(ROOT, 'apps/rider/app/pick-driver.tsx'), 'utf8')
  const boundary = readFileSync(path.join(ROOT, 'apps/rider/components/FlowErrorBoundary.tsx'), 'utf8')
  assert.match(screen, /readablePickerDrivers/)
  assert.match(screen, /pickerDriverCard/)
  assert.match(screen, /<FlowErrorBoundary title="Clemson Rides" fill>\s*<DriverRoster/)
  assert.match(boundary, /Try again/)
  assert.match(boundary, /colors\.orange/)
  const renderDriver = screen.slice(screen.indexOf('function renderDriver'), screen.indexOf('function renderGroups'))
  const selectClose = renderDriver.indexOf('</Pressable>')
  const save = renderDriver.indexOf('Save ${card.name}')
  assert.ok(selectClose > 0 && save > selectClose, 'Save sits outside the card pressable')
})
