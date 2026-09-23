import assert from 'node:assert/strict'
import test from 'node:test'
import { platformFeeCents, splitPlatformCut } from './platformFee.js'

test('platform fee is 20% of fares, tips, wait, and cancel', () => {
  const cut = splitPlatformCut({
    fareCents: 10000,
    tipCents: 500,
    waitFeeCents: 200,
    cancelFeeCents: 300,
  })
  assert.equal(cut.grossCents, 11000)
  assert.equal(cut.platformFeeCents, 2200)
  assert.equal(cut.driverNetCents, 8800)
  assert.equal(platformFeeCents(11000), 2200)
})

test('driver net is the remaining 80% after one rounding', () => {
  const cut = splitPlatformCut({ fareCents: 10001 })
  assert.equal(cut.platformFeeCents, 2000)
  assert.equal(cut.driverNetCents, 8001)
})
