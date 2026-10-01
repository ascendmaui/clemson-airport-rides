import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ALERT_LEVELS,
  DND_COPY,
  QUIET_HOURS_COPY,
  SYNC_STATUS_COPY,
  SYSTEM_ALERT_KINDS,
  formatSyncFeedback,
  categoryForAlertKind,
  isCriticalAlert,
  toneForAlertKind,
  formatSystemAlert,
} from '../packages/rides-native/systemAlertsCopy.js'

test('ALERT_LEVELS, DND_COPY, and QUIET_HOURS_COPY define canonical constants', () => {
  assert.equal(ALERT_LEVELS.INFO, 'info')
  assert.equal(ALERT_LEVELS.SUCCESS, 'success')
  assert.equal(ALERT_LEVELS.WARNING, 'warning')
  assert.equal(ALERT_LEVELS.ERROR, 'error')

  assert.equal(DND_COPY.TITLE, 'Do not disturb — new requests')
  assert.ok(DND_COPY.DESCRIPTION.includes('Mutes the new-request tone'))

  assert.equal(QUIET_HOURS_COPY.TITLE, 'Quiet hours')
  assert.ok(QUIET_HOURS_COPY.DESCRIPTION.includes('scheduled hours'))
})

test('formatSyncFeedback handles persisted, soft-fail, and platform variants', () => {
  assert.equal(formatSyncFeedback(true, null, false), SYNC_STATUS_COPY.SAVED_TO_ACCOUNT)
  assert.equal(formatSyncFeedback(false, null, true), SYNC_STATUS_COPY.SAVED_ON_PHONE)
  assert.equal(formatSyncFeedback(false, null, false), SYNC_STATUS_COPY.SAVED_ON_DEVICE)

  assert.equal(
    formatSyncFeedback(false, 'profiles RLS denied', true),
    'Saved on this phone. Profile sync: profiles RLS denied'
  )
  assert.equal(
    formatSyncFeedback(false, 'column missing', false),
    'Saved on this device. Profile sync: column missing'
  )
})

test('SYSTEM_ALERT_KINDS catalog contains valid properties for all standard alerts', () => {
  const allowedCategories = ['ride', 'billing', 'friends', 'promotions', 'system']
  const allowedLevels = [ALERT_LEVELS.INFO, ALERT_LEVELS.SUCCESS, ALERT_LEVELS.WARNING, ALERT_LEVELS.ERROR]
  const allowedTones = ['orange', 'purple', 'danger']

  const keys = Object.keys(SYSTEM_ALERT_KINDS)
  assert.ok(keys.length >= 18)

  for (const [key, meta] of Object.entries(SYSTEM_ALERT_KINDS)) {
    assert.ok(meta.title, `Alert ${key} must have a title`)
    assert.ok(meta.defaultBody, `Alert ${key} must have a defaultBody`)
    assert.ok(allowedCategories.includes(meta.category), `Alert ${key} category ${meta.category} is valid`)
    assert.ok(allowedLevels.includes(meta.level), `Alert ${key} level ${meta.level} is valid`)
    assert.ok(allowedTones.includes(meta.tone), `Alert ${key} tone ${meta.tone} is valid`)
  }
})

test('categoryForAlertKind maps kinds to preferences categories accurately', () => {
  assert.equal(categoryForAlertKind('ride_requested'), 'ride')
  assert.equal(categoryForAlertKind('driver_accepted'), 'ride')
  assert.equal(categoryForAlertKind('arrived_pickup'), 'ride')
  assert.equal(categoryForAlertKind('fare_charged'), 'billing')
  assert.equal(categoryForAlertKind('payment_failed'), 'billing')
  assert.equal(categoryForAlertKind('friend_joined'), 'friends')
  assert.equal(categoryForAlertKind('carpool_booked'), 'friends')
  assert.equal(categoryForAlertKind('driver_incentive'), 'system')
  assert.equal(categoryForAlertKind('promo_code_applied'), 'promotions')
  assert.equal(categoryForAlertKind('unknown_event'), 'system')
})

test('isCriticalAlert identifies safety and payment critical events', () => {
  assert.equal(isCriticalAlert('canceled_midride'), true)
  assert.equal(isCriticalAlert('payment_failed'), true)
  assert.equal(isCriticalAlert('payment_required'), true)
  assert.equal(isCriticalAlert('ride_requested'), false)
  assert.equal(isCriticalAlert('driver_accepted'), false)
})

test('toneForAlertKind returns matching color tokens', () => {
  assert.equal(toneForAlertKind('payment_failed'), 'danger')
  assert.equal(toneForAlertKind('driver_accepted'), 'purple')
  assert.equal(toneForAlertKind('ride_requested'), 'orange')
  assert.equal(toneForAlertKind('unknown_kind'), 'purple')
})

test('formatSystemAlert constructs accessible alert payloads', () => {
  const infoAlert = formatSystemAlert('ride_requested')
  assert.equal(infoAlert.title, 'Ride requested')
  assert.equal(infoAlert.level, ALERT_LEVELS.INFO)
  assert.equal(infoAlert.ariaRole, 'status')
  assert.equal(infoAlert.liveRegion, 'polite')
  assert.equal(infoAlert.critical, false)

  const criticalAlert = formatSystemAlert('payment_failed')
  assert.equal(criticalAlert.title, 'Payment failed')
  assert.equal(criticalAlert.level, ALERT_LEVELS.ERROR)
  assert.equal(criticalAlert.ariaRole, 'alert')
  assert.equal(criticalAlert.liveRegion, 'assertive')
  assert.equal(criticalAlert.critical, true)

  const customAlert = formatSystemAlert('ride_reminder', {
    title: 'Custom Reminder',
    body: 'Be ready in 5 minutes',
    force: true,
  })
  assert.equal(customAlert.title, 'Custom Reminder')
  assert.equal(customAlert.body, 'Be ready in 5 minutes')
  assert.equal(customAlert.ariaRole, 'alert')
  assert.equal(customAlert.liveRegion, 'assertive')
  assert.equal(customAlert.critical, true)
})
