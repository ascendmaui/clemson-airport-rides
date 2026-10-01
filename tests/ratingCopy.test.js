import assert from 'node:assert/strict'
import test from 'node:test'
import {
  STAR_DESCRIPTORS,
  getStarDescriptor,
  RIDER_COMPLIMENTS,
  DRIVER_COMPLIMENTS,
  RIDER_IMPROVEMENT_TAGS,
  DRIVER_IMPROVEMENT_TAGS,
  getFeedbackTagsForRating,
  formatRatingDisplay,
  STANDING_COPY,
  formatStandingBadge,
  RATING_SUBMISSION_TITLE,
  RATING_SUBMISSION_NOTE,
} from '../packages/rides-native/ratingCopy.js'

test('STAR_DESCRIPTORS defines labels from 1 to 5 stars', () => {
  assert.equal(getStarDescriptor(1), 'Poor')
  assert.equal(getStarDescriptor(2), 'Below average')
  assert.equal(getStarDescriptor(3), 'OK')
  assert.equal(getStarDescriptor(4), 'Good')
  assert.equal(getStarDescriptor(5), 'Excellent')

  assert.equal(getStarDescriptor(0), '')
  assert.equal(getStarDescriptor(6), '')
  assert.equal(getStarDescriptor(null), '')
})

test('Feedback tag lists provide standard compliments and improvement tags', () => {
  assert.ok(RIDER_COMPLIMENTS.length >= 5)
  assert.ok(DRIVER_COMPLIMENTS.length >= 4)
  assert.ok(RIDER_IMPROVEMENT_TAGS.length >= 4)
  assert.ok(DRIVER_IMPROVEMENT_TAGS.length >= 3)

  // Rider gives 5 stars -> returns rider compliments
  const riderPositive = getFeedbackTagsForRating('rider', 5)
  assert.equal(riderPositive, RIDER_COMPLIMENTS)

  // Rider gives 2 stars -> returns rider improvement tags
  const riderNegative = getFeedbackTagsForRating('rider', 2)
  assert.equal(riderNegative, RIDER_IMPROVEMENT_TAGS)

  // Driver gives 4 stars -> returns driver compliments
  const driverPositive = getFeedbackTagsForRating('driver', 4)
  assert.equal(driverPositive, DRIVER_COMPLIMENTS)

  // Driver gives 1 star -> returns driver improvement tags
  const driverNegative = getFeedbackTagsForRating('driver', 1)
  assert.equal(driverNegative, DRIVER_IMPROVEMENT_TAGS)
})

test('formatRatingDisplay formats scores across multiple presentation styles', () => {
  // Populated ratings
  assert.equal(formatRatingDisplay(4.85, 12, { style: 'compact' }), '★ 4.9')
  assert.equal(formatRatingDisplay(4.85, 12, { style: 'card' }), '★ 4.9 (12)')
  assert.equal(formatRatingDisplay(4.85, 12, { style: 'full' }), '4.9 ★ (12 ratings)')
  assert.equal(formatRatingDisplay(5.0, 1, { style: 'full' }), '5.0 ★ (1 rating)')
  assert.equal(
    formatRatingDisplay(4.85, 12, { style: 'accessible' }),
    '4.9 stars across 12 ratings'
  )

  // Zero / new user
  assert.equal(formatRatingDisplay(null, 0, { style: 'compact' }), 'New')
  assert.equal(formatRatingDisplay(null, 0, { style: 'full' }), 'New · no ratings yet')
  assert.equal(formatRatingDisplay(null, 0, { style: 'card', role: 'driver' }), 'New driver')
  assert.equal(formatRatingDisplay(null, 0, { style: 'card', role: 'rider' }), 'New rider')
  assert.equal(
    formatRatingDisplay(null, 0, { style: 'accessible', role: 'driver' }),
    'New driver with no ratings yet'
  )
})

test('formatStandingBadge returns appropriate badge tone and hint', () => {
  const good = formatStandingBadge('good')
  assert.equal(good.label, 'Good standing')
  assert.equal(good.tone, 'neutral')

  const watch = formatStandingBadge('watch')
  assert.equal(watch.label, 'Low rating')
  assert.equal(watch.tone, 'warn')
  assert.ok(watch.hint.includes('3.0'))

  const restricted = formatStandingBadge('restricted')
  assert.equal(restricted.label, 'Account restricted')
  assert.equal(restricted.tone, 'danger')

  // Unknown defaults to good
  assert.equal(formatStandingBadge('unknown').label, 'Good standing')
})

test('RATING_SUBMISSION constants provide standard feedback copy', () => {
  assert.ok(RATING_SUBMISSION_TITLE.includes('Thanks'))
  assert.ok(RATING_SUBMISSION_NOTE.includes('Clemson'))
})
