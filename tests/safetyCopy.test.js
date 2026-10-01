import test from 'node:test'
import assert from 'node:assert/strict'
import {
  EMERGENCY_SOS_HEADING,
  SOS_DISCLAIMERS,
  SOS_ACTION_LABELS,
  SAFETY_PAGE_COPY,
  resolveCounterpartParty,
  formatSosConfirmCopy,
  formatSosActiveCopy,
  formatSosBannerTitle,
  formatLocationLine,
} from '../packages/rides-native/safetyCopy.js'

test('EMERGENCY_SOS_HEADING, DISCLAIMERS, and ACTION_LABELS define canonical SOS constants', () => {
  assert.equal(EMERGENCY_SOS_HEADING, 'Emergency SOS')

  assert.ok(SOS_DISCLAIMERS.CONFIRM('driver').includes('alert your driver in the app'))
  assert.ok(SOS_DISCLAIMERS.CONFIRM('rider').includes('alert your rider in the app'))
  assert.ok(SOS_DISCLAIMERS.ACTIVE('driver').includes('Your driver sees an in-app SOS banner'))
  assert.ok(SOS_DISCLAIMERS.ACTIVE('rider').includes('Your rider sees an in-app SOS banner'))
  assert.equal(
    SOS_DISCLAIMERS.LOG_ERROR('connection lost'),
    'Could not save the SOS log (connection lost). You can still call 911.'
  )

  assert.equal(SOS_ACTION_LABELS.SLIDE_TO_ACTIVATE, 'Slide to activate SOS')
  assert.equal(SOS_ACTION_LABELS.HOLD_TO_ACTIVATE, 'Hold to activate SOS')
  assert.equal(SOS_ACTION_LABELS.HOLDING, 'Hold…')
  assert.equal(SOS_ACTION_LABELS.ACTIVATING, 'Activating SOS…')
  assert.equal(SOS_ACTION_LABELS.CANCEL, 'Cancel')
  assert.equal(SOS_ACTION_LABELS.CLOSE, 'Close')
  assert.equal(SOS_ACTION_LABELS.LOCATING, 'Getting your location…')
  assert.equal(SOS_ACTION_LABELS.GPS_UNAVAILABLE, 'GPS unavailable')
})

test('SAFETY_PAGE_COPY defines campus safety and contacts guidelines', () => {
  assert.equal(SAFETY_PAGE_COPY.TITLE, 'Safety & support')
  assert.equal(SAFETY_PAGE_COPY.EMERGENCY_CONTACTS_TITLE, 'Emergency contacts')
  assert.ok(SAFETY_PAGE_COPY.EMERGENCY_CONTACTS_SUBTITLE.includes('5 trusted contacts'))
  assert.equal(SAFETY_PAGE_COPY.CUPD_INFO_TITLE, 'Clemson Police (CUPD)')
  assert.ok(SAFETY_PAGE_COPY.CUPD_INFO_HINT.includes('24/7'))
})

test('resolveCounterpartParty flips viewer role to counterpart', () => {
  assert.equal(resolveCounterpartParty('rider'), 'driver')
  assert.equal(resolveCounterpartParty('driver'), 'rider')
  assert.equal(resolveCounterpartParty('RIDER'), 'driver')
  assert.equal(resolveCounterpartParty('DRIVER'), 'rider')
  assert.equal(resolveCounterpartParty(null), 'driver')
})

test('formatSosConfirmCopy and formatSosActiveCopy format based on role', () => {
  const riderConfirm = formatSosConfirmCopy('rider')
  assert.ok(riderConfirm.includes('alert your driver in the app'))

  const driverConfirm = formatSosConfirmCopy('driver')
  assert.ok(driverConfirm.includes('alert your rider in the app'))

  const riderActive = formatSosActiveCopy('rider')
  assert.ok(riderActive.includes('Your driver sees an in-app SOS banner'))

  const driverActive = formatSosActiveCopy('driver')
  assert.ok(driverActive.includes('Your rider sees an in-app SOS banner'))
})

test('formatSosBannerTitle formats incoming emergency alerts', () => {
  assert.equal(
    formatSosBannerTitle('driver', 'called 911'),
    'Your driver called 911'
  )
  assert.equal(
    formatSosBannerTitle('rider', 'sent an in-app SOS'),
    'Your rider sent an in-app SOS'
  )
  assert.equal(
    formatSosBannerTitle(null, null),
    'Your driver activated SOS'
  )
})

test('formatLocationLine formats coordinates with 5 decimals', () => {
  assert.equal(
    formatLocationLine(34.67841, -82.83972),
    'GPS: 34.67841, -82.83972'
  )
  assert.equal(formatLocationLine(null, null), 'GPS unavailable')
  assert.equal(formatLocationLine(NaN, -82.83972), 'GPS unavailable')
})
