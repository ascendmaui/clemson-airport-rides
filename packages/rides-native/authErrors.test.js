import assert from 'node:assert/strict'
import test from 'node:test'
import {
  displayFirstName,
  getSignupRateLimitRemainingSec,
  isClemsonEmail,
  isRateLimitError,
  mapAuthError,
  markSignupRateLimited,
  normalizePromoCode,
  SIGNUP_RATE_LIMIT_COOLDOWN_SEC,
  standingFromRatings,
} from './authErrors.js'

function memoryStorage(seed = {}) {
  const data = { ...seed }
  return {
    data,
    async getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null
    },
    async setItem(key, value) {
      data[key] = value
    },
    async removeItem(key) {
      delete data[key]
    },
  }
}

test('maps signup rate limits to the web copy and cooldown', () => {
  const err = mapAuthError({ status: 429, message: 'email rate limit exceeded' })
  assert.equal(err.code, 'over_email_send_rate_limit')
  assert.equal(err.status, 429)
  assert.equal(err.retryAfterSec, SIGNUP_RATE_LIMIT_COOLDOWN_SEC)
  assert.match(err.message, /Too many signup emails/)
  assert.equal(isRateLimitError(err), true)
  assert.equal(isRateLimitError(new Error('Invalid login credentials')), false)
})

test('keeps a non-rate-limit auth error', () => {
  const err = mapAuthError(new Error('Invalid login credentials'))
  assert.equal(err.message, 'Invalid login credentials')
  assert.equal(err.code, undefined)
})

test('clemson.edu emails qualify for student verification', () => {
  assert.equal(isClemsonEmail(' Tiger@Clemson.edu '), true)
  assert.equal(isClemsonEmail('tiger@g.clemson.edu'), true)
  assert.equal(isClemsonEmail('tiger@gmail.com'), false)
  assert.equal(isClemsonEmail(''), false)
})

test('promo codes match the web normalizer', () => {
  assert.equal(normalizePromoCode(' ab-12 '), 'AB12')
  assert.equal(normalizePromoCode(''), '')
})

test('signup cooldown is stored and then cleared', async () => {
  const storage = memoryStorage()
  await markSignupRateLimited(storage, 30)
  const left = await getSignupRateLimitRemainingSec(storage)
  assert.ok(left <= 30 && left > 0)
  storage.data.clemson_signup_rate_limit_until = String(Date.now() - 1000)
  assert.equal(await getSignupRateLimitRemainingSec(storage), 0)
  assert.equal(storage.data.clemson_signup_rate_limit_until, undefined)
})

test('standing thresholds match the web helper', () => {
  assert.equal(standingFromRatings(2.4, 5), 'restricted')
  assert.equal(standingFromRatings(2.9, 3), 'watch')
  assert.equal(standingFromRatings(2.4, 2), 'good')
  assert.equal(standingFromRatings(null, 0), 'good')
})

test('displayFirstName keeps the given name only', () => {
  assert.equal(displayFirstName('John Matveyev'), 'John')
  assert.equal(displayFirstName(''), 'Rider')
  assert.equal(displayFirstName(null, 'Driver'), 'Driver')
})
