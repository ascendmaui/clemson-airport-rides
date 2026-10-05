import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { DEMO_FLEET, isDemoDriverId } from './demoFleet.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('demo fleet matches the twelve named map cars and their photos', () => {
  assert.equal(DEMO_FLEET.length, 12)
  assert.deepEqual(DEMO_FLEET.map((car) => car.firstName), [
    'Marcus', 'Jenna', 'Darnell', 'Priya', 'Carlos', 'Hannah',
    'Terrence', 'Mei', 'Wade', 'Tasha', 'Luis', 'Brooke',
  ])
  assert.deepEqual(DEMO_FLEET.map((car) => car.vehicle), [
    'BMW X5',
    'Mercedes GLE',
    'Audi Q7',
    'Range Rover Sport',
    'Lexus RX',
    'Porsche Macan',
    'Cadillac Escalade',
    'Genesis GV80',
    'Ford F-150',
    'Ford F-150',
    'Ford F-150',
    DEMO_FLEET[11].vehicle,
  ])
  for (const car of DEMO_FLEET) {
    assert.equal(car.isDemo, true)
    assert.equal(car.source, 'demo')
    assert.equal(car.bookable, false)
    assert.equal(car.online, false)
    assert.equal(isDemoDriverId(car.id), true)
    assert.match(car.photo, /^\/demo-drivers\//)
    assert.match(car.photoSmall, /^\/demo-drivers\//)
    assert.equal(existsSync(path.join(root, 'public', car.photo)), true)
    assert.equal(existsSync(path.join(root, 'public', car.photoSmall)), true)
  }
  assert.equal(DEMO_FLEET.filter((car) => car.body === 'wedge').length, 1)
  assert.equal(DEMO_FLEET.filter((car) => car.body === 'truck').length, 3)
  assert.equal(isDemoDriverId('11111111-1111-4111-8111-111111111111'), false)
})
