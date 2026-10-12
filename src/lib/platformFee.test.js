import assert from 'node:assert/strict'
import test from 'node:test'
import { platformFeeCents, splitPlatformCut } from './platformFee.js'

test('platform fee is 20% of fares, wait, and cancel; tips pass through at 100%', () => {
  const cut = splitPlatformCut({
    fareCents: 10000,
    tipCents: 500,
    waitFeeCents: 200,
    cancelFeeCents: 300,
  })
  assert.equal(cut.grossCents, 11000)
  assert.equal(cut.platformFeeCents, 2100)
  assert.equal(cut.driverNetCents, 8900)
  const tipOnly = splitPlatformCut({ tipCents: 500 })
  assert.equal(tipOnly.platformFeeCents, 0)
  assert.equal(tipOnly.driverNetCents, 500)
  assert.equal(platformFeeCents(11000), 2200)
})

test('driver net is the remaining 80% after one rounding', () => {
  const cut = splitPlatformCut({ fareCents: 10001 })
  assert.equal(cut.platformFeeCents, 2000)
  assert.equal(cut.driverNetCents, 8001)
})
