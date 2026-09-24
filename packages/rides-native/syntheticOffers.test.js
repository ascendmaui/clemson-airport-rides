import assert from 'node:assert/strict'
import test from 'node:test'
import { approvalGateMessage, isSyntheticOffer, syntheticOffers } from './syntheticOffers.js'

test('pending offers look like rides and stay off dispatch', () => {
  const offers = syntheticOffers(new Date('2026-09-24T12:00:00Z'))
  assert.ok(offers.length >= 3)
  const blob = JSON.stringify(offers).toLowerCase()
  assert.equal(blob.includes('sample'), false)
  assert.equal(blob.includes('preview'), false)
  assert.equal(blob.includes('demo'), false)
  for (const offer of offers) {
    assert.equal(offer.isSynthetic, true)
    assert.equal(isSyntheticOffer(offer), true)
    assert.ok(offer.pickupLabel)
    assert.ok(offer.dropoffLabel)
    assert.ok(offer.firstName)
    assert.ok(offer.fareCents > 0)
    assert.ok(offer.driverNetCents > 0)
  }
  assert.match(offers.map((offer) => offer.dropoffLabel).join(' '), /GSP/)
  assert.match(approvalGateMessage(), /under review/)
})
