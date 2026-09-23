import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldPlayAlertTone } from './alertTone.js'
import { isTripSurfaceFrozen, isTripSurfaceLive } from './tripPhase.js'

test('DND mutes new-request tones and never mutes a mid-ride cancel', () => {
  const dnd = { dndNewRequestTones: true }
  assert.equal(shouldPlayAlertTone('ride_requested', dnd), false)
  assert.equal(shouldPlayAlertTone('ride_requested', { dndNewRequestTones: false }), true)
  assert.equal(shouldPlayAlertTone('canceled_midride', dnd), true)
  assert.equal(shouldPlayAlertTone('trip_completed', dnd), false)
})

test('a mid-ride cancel freezes tracking, queue, and the composer', () => {
  assert.equal(isTripSurfaceLive('in_progress'), true)
  assert.equal(isTripSurfaceLive('arrived'), true)
  assert.equal(isTripSurfaceFrozen('in_progress'), false)
  assert.equal(isTripSurfaceFrozen('cancelled_wait'), true)
  assert.equal(isTripSurfaceLive('canceled_midride'), false)
  assert.equal(isTripSurfaceFrozen('canceled_midride'), true)
  assert.equal(isTripSurfaceFrozen('canceled'), true)
  assert.equal(isTripSurfaceFrozen('completed'), true)
})
