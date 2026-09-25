import assert from 'node:assert/strict'
import test from 'node:test'
import { APPROVAL_GATE, driverGateView, ONBOARDING_STATUSES } from './driverGateView.js'
import { approvalGateMessage } from './syntheticOffers.js'

test('driverGateView exports and reuses APPROVAL_GATE copy from syntheticOffers', () => {
  assert.equal(APPROVAL_GATE, approvalGateMessage())
  assert.equal(APPROVAL_GATE, 'Finish approval to go online. Your account is still under review.')
})

test('every ONBOARDING_STATUS plus null returns the expected 5 fields', () => {
  const allStatuses = [...ONBOARDING_STATUSES, null, undefined, 'none']
  const requiredKeys = ['canGoOnline', 'canSeeOffers', 'title', 'body', 'primaryAction'].sort()

  for (const status of allStatuses) {
    const view = driverGateView(status)
    assert.deepEqual(Object.keys(view).sort(), requiredKeys, `Status "${status}" should have exact required keys`)
    assert.equal(typeof view.canGoOnline, 'boolean')
    assert.equal(typeof view.canSeeOffers, 'boolean')
    assert.equal(typeof view.title, 'string')
    assert.ok(view.title.length > 0)
    assert.equal(typeof view.body, 'string')
    assert.ok(view.body.length > 0)
    assert.ok(view.primaryAction === null || typeof view.primaryAction === 'string')
  }
})

test('approved drivers can go online and see offers, with no further gate action', () => {
  const view = driverGateView('approved')
  assert.deepEqual(view, {
    canGoOnline: true,
    canSeeOffers: true,
    title: 'Approved',
    body: 'You are approved to go online and accept rides.',
    primaryAction: null,
  })
})

test('pending_review drivers cannot go online or see offers, and view uses APPROVAL_GATE copy', () => {
  const view = driverGateView('pending_review')
  assert.deepEqual(view, {
    canGoOnline: false,
    canSeeOffers: false,
    title: 'Application under review',
    body: APPROVAL_GATE,
    primaryAction: 'View application',
  })
  assert.match(view.body, /Finish approval to go online/)
  assert.match(view.body, /under review/)
})

test('pending_docs drivers cannot go online or see offers, prompting document completion', () => {
  const defaultView = driverGateView('pending_docs')
  assert.equal(defaultView.canGoOnline, false)
  assert.equal(defaultView.canSeeOffers, false)
  assert.equal(defaultView.title, 'Finish your application')
  assert.equal(
    defaultView.body,
    'License, insurance, registration, and car photos come before you submit. You can keep setting up the account after that.'
  )
  assert.equal(defaultView.primaryAction, 'Continue application')

  const withMissing = driverGateView('pending_docs', {
    missingItems: ['insurance_front', 'registration'],
  })
  assert.match(withMissing.body, /Missing: Insurance card — front, Car registration\./)
  assert.match(withMissing.body, /License, insurance, registration, and car photos come before you submit\./)
  assert.equal(withMissing.primaryAction, 'Continue application')

  const withCustomStrings = driverGateView('pending_docs', {
    missingItems: ['Driver license photo', 'Vehicle inspection'],
  })
  assert.match(withCustomStrings.body, /Missing: Driver license photo, Vehicle inspection\./)
})

test('pending_info drivers cannot go online or see offers, prompting initial signup completion', () => {
  const defaultView = driverGateView('pending_info')
  assert.equal(defaultView.canGoOnline, false)
  assert.equal(defaultView.canSeeOffers, false)
  assert.equal(defaultView.title, 'Finish driver signup')
  assert.equal(
    defaultView.body,
    'Add your info, vehicle, documents, W-9, and contractor agreement. New drivers are not approved automatically.'
  )
  assert.equal(defaultView.primaryAction, 'Continue application')

  const withMissing = driverGateView('pending_info', {
    missingItems: ['vehicle_info', 'w9_tax_info'],
  })
  assert.match(withMissing.body, /Missing: vehicle_info, W-9 legal name and TIN\./)
  assert.match(withMissing.body, /Add your info, vehicle, documents, W-9, and contractor agreement\./)
})

test('rejected drivers cannot go online or see offers, prompting updates with optional rejection reason', () => {
  const defaultView = driverGateView('rejected')
  assert.equal(defaultView.canGoOnline, false)
  assert.equal(defaultView.canSeeOffers, false)
  assert.equal(defaultView.title, 'Application needs changes')
  assert.equal(
    defaultView.body,
    'Update the flagged steps and submit again. You still cannot receive rides.'
  )
  assert.equal(defaultView.primaryAction, 'Continue application')

  const withReason = driverGateView('rejected', {
    rejectionReason: 'Driver license photo was blurry and unreadable.',
  })
  assert.equal(withReason.canGoOnline, false)
  assert.equal(withReason.canSeeOffers, false)
  assert.equal(withReason.title, 'Application needs changes')
  assert.equal(
    withReason.body,
    'Update the flagged steps and submit again: Driver license photo was blurry and unreadable. You still cannot receive rides.'
  )
  assert.equal(withReason.primaryAction, 'Continue application')

  const withReasonAndMissing = driverGateView('rejected', {
    rejectionReason: 'Expired insurance card',
    missingItems: ['insurance_front'],
  })
  assert.match(withReasonAndMissing.body, /Update the flagged steps and submit again: Expired insurance card\./)
  assert.match(withReasonAndMissing.body, /Missing: Insurance card — front\./)
})

test('null, undefined, and "none" statuses return the initial unstarted become a driver view', () => {
  for (const status of [null, undefined, 'none']) {
    const view = driverGateView(status)
    assert.deepEqual(view, {
      canGoOnline: false,
      canSeeOffers: false,
      title: 'Become a driver',
      body: 'For Clemson University students — and for drivers already on Uber or Lyft.',
      primaryAction: 'Become a driver',
    })
  }
})

test('unknown status safely falls back to become a driver view', () => {
  const view = driverGateView('unknown_status_123')
  assert.equal(view.canGoOnline, false)
  assert.equal(view.canSeeOffers, false)
  assert.equal(view.title, 'Become a driver')
  assert.equal(view.primaryAction, 'Become a driver')
})

test('canGoOnline and canSeeOffers are strictly true ONLY for approved status', () => {
  for (const status of ONBOARDING_STATUSES) {
    const view = driverGateView(status)
    if (status === 'approved') {
      assert.equal(view.canGoOnline, true)
      assert.equal(view.canSeeOffers, true)
    } else {
      assert.equal(view.canGoOnline, false, `${status} must not be able to go online`)
      assert.equal(view.canSeeOffers, false, `${status} must not be able to see offers`)
    }
  }
  const nullView = driverGateView(null)
  assert.equal(nullView.canGoOnline, false)
  assert.equal(nullView.canSeeOffers, false)
})
