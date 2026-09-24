import assert from 'node:assert/strict'
import test from 'node:test'
import { licensePendingCopy, matchRegistration, reviewLicenseImage } from './documentReview.js'

test('a readable license photo is pending manual review and is not approved', () => {
  const review = reviewLicenseImage({
    mimeType: 'image/jpeg',
    size: 80_000,
    width: 1200,
    height: 800,
    text: 'DRIVER LICENSE CLASS EXP DOB',
  })
  assert.equal(review.ok, true)
  assert.equal(review.approved, false)
  assert.equal(review.reviewStatus, 'pending_manual_review')
  assert.match(licensePendingCopy('license_front'), /pending manual review/i)
  assert.match(licensePendingCopy('license_back'), /pending manual review/i)
})

test('a tiny or non-image license is rejected', () => {
  assert.equal(reviewLicenseImage({ mimeType: 'application/pdf', size: 80_000 }).ok, false)
  assert.equal(reviewLicenseImage({ mimeType: 'image/jpeg', size: 400, width: 100, height: 80 }).ok, false)
})

test('registration matches aliases and flags a mismatch or unreadable file', () => {
  const matched = matchRegistration({
    text: 'South Carolina registration Chevrolet Camaro gray plate ABC123',
    make: 'Chevy',
    model: 'Camaro',
    color: 'Gray',
    plate: 'ABC-123',
  })
  assert.equal(matched.status, 'matched')
  assert.equal(matched.matched, true)

  const mismatch = matchRegistration({
    text: 'South Carolina registration Honda Civic white plate ZZZ999',
    make: 'Toyota',
    model: 'Camry',
    color: 'Black',
    plate: 'ABC123',
  })
  assert.equal(mismatch.status, 'mismatch')
  assert.ok(mismatch.misses.includes('make'))

  const unreadable = matchRegistration({ text: 'abc', make: 'Honda', model: 'Civic', color: 'Black', plate: 'ABC123' })
  assert.equal(unreadable.status, 'unreadable')
  assert.equal(unreadable.matched, false)
})
