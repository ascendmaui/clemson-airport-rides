import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SAFETY_FEATURES,
  beginRecording,
  failRecording,
  finishRecording,
  idleRecording,
  preferredRecordingMime,
  recordingBlockReason,
  recordingIndicatorLabel,
} from './safetyHub.js'

test('safety features stay the four requested tools in one list', () => {
  assert.deepEqual(SAFETY_FEATURES.map((feature) => feature.id), ['audio', 'video', 'tracking', 'sos'])
  for (const feature of SAFETY_FEATURES) {
    assert.ok(feature.title)
    assert.ok(feature.body)
  }
})

test('recording waits for an accepted ride and a granted or still-unasked permission', () => {
  assert.match(recordingBlockReason({ status: 'searching', permission: 'granted', mode: 'audio' }), /accepted/)
  assert.equal(recordingBlockReason({ status: 'accepted', permission: 'granted', mode: 'audio' }), null)
  assert.equal(recordingBlockReason({ status: 'in_progress', permission: 'unknown', mode: 'video' }), null)
  assert.match(recordingBlockReason({ status: 'arriving', permission: 'denied', mode: 'video' }), /Camera/)
  assert.match(recordingBlockReason({ status: 'arriving', permission: 'denied', mode: 'audio' }), /Microphone/)
})

test('recording state moves idle to recording to saved and does not start a second clip', () => {
  const idle = idleRecording()
  const live = beginRecording(idle, 'audio', '2026-10-05T12:00:00.000Z')
  assert.equal(live.phase, 'recording')
  assert.match(recordingIndicatorLabel(live.mode), /Audio recording is on/)
  const blocked = beginRecording(live, 'video', '2026-10-05T12:01:00.000Z')
  assert.equal(blocked.phase, 'recording')
  assert.equal(blocked.mode, 'audio')
  const saved = finishRecording(live, 'file://clip.m4a')
  assert.equal(saved.phase, 'saved')
  assert.match(saved.note, /saved on this phone/)
  assert.match(failRecording(live, 'Microphone access is off.').note, /Microphone/)
})

test('mime choice follows what the browser says it can record', () => {
  assert.equal(preferredRecordingMime('audio', (type) => type === 'audio/webm'), 'audio/webm')
  assert.equal(preferredRecordingMime('video', () => false), '')
  assert.equal(preferredRecordingMime('video', (type) => type.startsWith('video/mp4')), 'video/mp4')
})
