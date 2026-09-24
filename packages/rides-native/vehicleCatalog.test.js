import assert from 'node:assert/strict'
import test from 'node:test'
import { modelsForMake, VEHICLE_COLORS, VEHICLE_MAKES } from './vehicleCatalog.js'

test('models are filtered by make and color includes the shared list', () => {
  assert.ok(VEHICLE_MAKES.includes('Toyota'))
  assert.ok(VEHICLE_MAKES.includes('Mercedes-Benz'))
  assert.deepEqual(modelsForMake(''), [])
  assert.ok(modelsForMake('Honda').includes('Civic'))
  assert.equal(modelsForMake('Honda').includes('Camry'), false)
  assert.ok(VEHICLE_COLORS.includes('Orange'))
  assert.ok(VEHICLE_COLORS.includes('Other'))
})
