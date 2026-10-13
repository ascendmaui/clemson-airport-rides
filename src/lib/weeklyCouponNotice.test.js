import assert from 'node:assert/strict'
import test from 'node:test'
import {
  readExplicitNotificationPrefs,
  weeklyDropAllowed,
  weeklyDropToast,
} from './weeklyCouponNotice.js'

const coupon = {
  id: 'tillman-twilight:2026-10-09',
  code: 'TILLMAN261009',
  title: 'Tillman twilight',
  detail: '30% off a ride that starts at Tillman Hall after 7:00 PM.',
}

test('signed-in riders get one Friday toast until they opt out of promotions', () => {
  assert.equal(weeklyDropToast({ coupon, signedIn: false }), null)
  assert.equal(weeklyDropAllowed(null), true)
  assert.equal(weeklyDropAllowed({ promotions: false }), false)
  const toast = weeklyDropToast({ coupon, signedIn: true, seenId: '' })
  assert.equal(toast.kind, 'promo_weekly')
  assert.equal(toast.force, true)
  assert.match(toast.body, /TILLMAN261009/)
  assert.equal(weeklyDropToast({ coupon, signedIn: true, seenId: coupon.id }), null)
  assert.equal(weeklyDropToast({ coupon, signedIn: true, prefs: { promotions: false } }), null)
})

test('a missing prefs record is not treated as an opt-out', () => {
  const storage = {
    getItem() { return null },
    setItem() {},
  }
  assert.equal(readExplicitNotificationPrefs('user-1', storage), null)
  assert.equal(weeklyDropAllowed(readExplicitNotificationPrefs('user-1', storage)), true)
})
