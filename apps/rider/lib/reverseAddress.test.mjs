import assert from 'node:assert/strict'
import test from 'node:test'
import { addressFromGeocode } from './reverseAddress.ts'

test('addressFromGeocode builds a street address and falls back to a place name', () => {
  assert.equal(addressFromGeocode({
    streetNumber: '123',
    street: 'College Ave',
    city: 'Clemson',
    region: 'SC',
  }), '123 College Ave, Clemson, SC')
  assert.equal(addressFromGeocode({
    name: 'Memorial Stadium',
    street: 'Avenue of Champions',
    city: 'Clemson',
    region: 'SC',
  }), 'Memorial Stadium, Clemson, SC')
  assert.equal(addressFromGeocode({
    name: '100 College Ave',
    streetNumber: '100',
    street: 'College Ave',
    city: 'Clemson',
  }), '100 College Ave, Clemson')
  assert.equal(addressFromGeocode(null), '')
  assert.equal(addressFromGeocode({}), '')
})
