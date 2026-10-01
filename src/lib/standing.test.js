import assert from 'node:assert/strict'
import test from 'node:test'
import { RATING_STANDING, standingFromRatings } from './standing.js'

test('RATING_STANDING constants define two-way thresholds', () => {
  assert.equal(RATING_STANDING.watchBelow, 3)
  assert.equal(RATING_STANDING.watchMinCount, 3)
  assert.equal(RATING_STANDING.restrictBelow, 2.5)
  assert.equal(RATING_STANDING.restrictMinCount, 5)
})

test('thin rating samples (< 3) are never flagged as watch or restricted', () => {
  // Even a 1.0 average is 'good' if there are fewer than 3 ratings
  assert.equal(standingFromRatings(1.0, 0), 'good')
  assert.equal(standingFromRatings(1.0, 1), 'good')
  assert.equal(standingFromRatings(1.5, 2), 'good')
  assert.equal(standingFromRatings(5.0, 2), 'good')
})

test('moderate rating samples (3 or 4) trigger watch but never restricted', () => {
  // Between 3 and 4 ratings, low ratings trigger 'watch'
  assert.equal(standingFromRatings(2.9, 3), 'watch')
  assert.equal(standingFromRatings(2.0, 3), 'watch', 'Low avg with count 3 is watch, not restricted')
  assert.equal(standingFromRatings(1.0, 4), 'watch', 'Low avg with count 4 is watch, not restricted')

  // Rating at or above 3.0 remains 'good'
  assert.equal(standingFromRatings(3.0, 3), 'good')
  assert.equal(standingFromRatings(3.5, 4), 'good')
  assert.equal(standingFromRatings(5.0, 4), 'good')
})

test('sufficient rating samples (>= 5) enforce restricted and watch boundaries', () => {
  // Average < 2.5 with 5+ ratings is restricted
  assert.equal(standingFromRatings(2.49, 5), 'restricted')
  assert.equal(standingFromRatings(1.0, 10), 'restricted')
  assert.equal(standingFromRatings(2.2, 50), 'restricted')

  // Average between 2.5 and 2.99 with 5+ ratings is watch
  assert.equal(standingFromRatings(2.5, 5), 'watch')
  assert.equal(standingFromRatings(2.99, 5), 'watch')
  assert.equal(standingFromRatings(2.8, 100), 'watch')

  // Average >= 3.0 with 5+ ratings is good
  assert.equal(standingFromRatings(3.0, 5), 'good')
  assert.equal(standingFromRatings(4.9, 20), 'good')
})

test('handles non-numeric strings, missing inputs, and invalid numbers cleanly', () => {
  assert.equal(standingFromRatings('2.1', '5'), 'restricted', 'Numeric strings are coerced')
  assert.equal(standingFromRatings('2.8', '4'), 'watch')

  assert.equal(standingFromRatings(NaN, 10), 'good')
  assert.equal(standingFromRatings(Infinity, 10), 'good')
  assert.equal(standingFromRatings(undefined, 10), 'good')
  assert.equal(standingFromRatings('invalid', 10), 'good')
  assert.equal(standingFromRatings(2.0, -1), 'good')
  assert.equal(standingFromRatings(2.0, null), 'good')
  assert.equal(standingFromRatings(2.0, 0), 'good')
})
