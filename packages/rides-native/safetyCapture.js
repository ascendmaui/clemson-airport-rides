/**
 * On-device ride recording and the driver live-trip share.
 * Clips stay on the phone. Nothing here uploads audio or video.
 */

import {
  recordingBlockReason,
  recordingIndicatorLabel,
} from '../../shared/safetyHub.js'
import { isActiveRideStatus, tripShareMessage } from './safety.js'

export const MICROPHONE_DENIED = 'Microphone access is off. Allow the microphone in Settings, then try again.'
export const CAMERA_DENIED = 'Camera access is off. Allow the camera in Settings, then try again.'
export const CAMERA_NOT_READY = 'Camera is not ready. Wait for the preview, then try again.'

export function formatRecordingClock(startedAt, now = Date.now()) {
  const start = Date.parse(startedAt || '')
  const elapsed = Number.isFinite(start) ? Math.max(0, Math.floor((now - start) / 1000)) : 0
  const minutes = Math.floor(elapsed / 60)
  const seconds = elapsed % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function recordingStatusLine(mode, startedAt, now = Date.now()) {
  return `${recordingIndicatorLabel(mode)} · ${formatRecordingClock(startedAt, now)}`
}

export function localClipName(mode, at = new Date()) {
  const stamp = at.toISOString().replace(/[:.]/g, '-')
  return mode === 'video' ? `clemson-rides-video-${stamp}.mp4` : `clemson-rides-audio-${stamp}.m4a`
}

function messageOf(err, fallback) {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err) return err
  return fallback
}

async function settle(value) {
  if (value && typeof value.then === 'function') await value
}

export async function startAudioCapture({ status, audio, recordingOptions, now = () => new Date().toISOString() }) {
  const blocked = recordingBlockReason({ status, permission: 'granted', mode: 'audio' })
  if (blocked) return { ok: false, permission: null, error: blocked }
  try {
    const permission = await audio.requestRecordingPermissionsAsync()
    if (!permission?.granted) return { ok: false, permission: 'denied', error: MICROPHONE_DENIED }
    await audio.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
    await audio.prepareToRecordAsync({ ...(recordingOptions || {}), directory: 'document' })
    await settle(audio.record())
    return { ok: true, permission: 'granted', startedAt: now() }
  } catch (err) {
    return { ok: false, permission: null, error: messageOf(err, 'Could not start audio') }
  }
}

export async function stopAudioCapture({ stop, getUri }) {
  await settle(stop())
  const uri = getUri() || null
  if (!uri) throw new Error('Audio clip was not saved on this phone.')
  return uri
}

export async function startDashcam({ status, camera, now = () => new Date().toISOString() }) {
  const blocked = recordingBlockReason({ status, permission: 'granted', mode: 'video' })
  if (blocked) return { ok: false, permission: null, error: blocked }
  try {
    const cam = await camera.requestCameraPermissionsAsync()
    if (!cam?.granted) return { ok: false, permission: 'denied', error: CAMERA_DENIED }
    const mic = await camera.requestMicrophonePermissionsAsync()
    if (!mic?.granted) return { ok: false, permission: 'denied', error: MICROPHONE_DENIED }
    if (!camera.ready) return { ok: false, permission: 'granted', arm: true }
    const pending = camera.recordAsync?.()
    if (!pending || typeof pending.then !== 'function') {
      return { ok: false, permission: 'granted', error: CAMERA_NOT_READY }
    }
    return { ok: true, permission: 'granted', startedAt: now(), pending }
  } catch (err) {
    return { ok: false, permission: null, error: messageOf(err, 'Could not start video') }
  }
}

export async function stopDashcam({ stopRecording, pending, persist }) {
  if (typeof stopRecording !== 'function') throw new Error('Could not stop video')
  stopRecording()
  const result = await pending
  const uri = result?.uri || null
  if (!uri) throw new Error('Video clip was not saved on this phone.')
  if (typeof persist === 'function') return persist(uri)
  return uri
}

export function backgroundLocationStatusLine(permission) {
  switch (permission) {
    case 'granted':
      return 'Background location is granted. Your rider can see the car while you use Maps or the phone is locked.'
    case 'denied':
      return 'Background location is not granted. Open Settings and set location to Always.'
    case 'unsupported':
      return 'Background location is not available on this device.'
    case 'unknown':
      return 'Checking background location…'
    default: {
      const unknown = permission
      throw new Error(`Unknown background location status: ${String(unknown)}`)
    }
  }
}

export async function readBackgroundLocationPermission({ platform, getBackgroundPermissionsAsync }) {
  if (platform !== 'ios' && platform !== 'android') return 'unsupported'
  try {
    const current = await getBackgroundPermissionsAsync()
    return current?.granted || current?.status === 'granted' ? 'granted' : 'denied'
  } catch {
    return 'unsupported'
  }
}

function shareDismissed(err) {
  return /cancel|dismiss/i.test(messageOf(err, ''))
}

export async function toggleDriverTripShare({ enabled, trip, share, createShare, revokeShare, presentShare }) {
  if (!enabled) {
    try {
      if (share?.id) await revokeShare(share.id)
    } catch (err) {
      return { ok: false, enabled: true, share, error: messageOf(err, 'Could not stop sharing') }
    }
    return { ok: true, enabled: false, share: null, note: 'Live trip sharing is off.' }
  }
  if (!trip?.id || !isActiveRideStatus(trip.status)) {
    return { ok: false, enabled: false, share: null, error: 'Live tracking is available once a ride is accepted.' }
  }
  if (!trip.riderId) {
    return { ok: false, enabled: false, share: null, error: 'This trip has no rider for the live link.' }
  }
  let next = share?.url ? share : null
  if (!next) {
    try {
      next = await createShare(trip.id, trip.riderId)
    } catch (err) {
      return { ok: false, enabled: false, share: null, error: messageOf(err, 'Could not start live tracking') }
    }
  }
  if (!next?.url) {
    return { ok: false, enabled: false, share: null, error: 'Could not start live tracking' }
  }
  const message = tripShareMessage({
    pickup: trip.pickupLabel,
    dropoff: trip.dropoffLabel,
    status: trip.status,
    url: next.url,
  })
  try {
    const outcome = await presentShare({ title: 'My Clemson RIDES trip', message, url: next.url })
    if (outcome?.action === 'dismissedAction') {
      return { ok: true, enabled: true, share: next, note: 'Live link is on. Share it when you are ready.' }
    }
  } catch (err) {
    if (!shareDismissed(err)) {
      return {
        ok: true,
        enabled: true,
        share: next,
        error: messageOf(err, 'Could not open sharing. The live link is still on.'),
      }
    }
  }
  return { ok: true, enabled: true, share: next, note: 'Live link ready to send to someone you trust.' }
}
