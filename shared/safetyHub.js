/**
 * One safety place: audio, video, live tracking, and SOS.
 * Recording stays on the device, starts only on an active ride, and is user-visible.
 */

import { isActiveRideStatus } from '../packages/rides-native/safety.js'

export const SAFETY_FEATURE_IDS = ['audio', 'video', 'tracking', 'sos']

export const SAFETY_FEATURES = [
  {
    id: 'audio',
    label: 'Audio',
    title: 'Audio recording',
    body: 'Record audio on this phone during an active ride. The clip stays on the device and is not uploaded. A banner stays up while it is recording.',
  },
  {
    id: 'video',
    label: 'Video',
    title: 'Video recording',
    body: 'Open the camera and save a clip on this phone during an active ride. The system camera is the indicator, and the clip is not uploaded.',
  },
  {
    id: 'tracking',
    label: 'Tracking',
    title: 'Live tracking',
    body: 'Share a live trip link with someone you trust. Location updates while the ride is underway.',
  },
  {
    id: 'sos',
    label: 'SOS',
    title: 'SOS',
    body: 'Call 911 or Clemson Police, or send an in-app alert. The first press confirms and does not dial.',
  },
]

export function safetyFeature(id) {
  return SAFETY_FEATURES.find((feature) => feature.id === id) || SAFETY_FEATURES[0]
}

export function idleRecording() {
  return { phase: 'idle', mode: null, startedAt: null, uri: null, note: null }
}

export function beginRecording(state, mode, at) {
  if (state?.phase === 'recording') {
    return { ...state, note: 'Stop the current recording first.' }
  }
  return { phase: 'recording', mode, startedAt: at, uri: null, note: null }
}

export function finishRecording(state, uri) {
  if (state?.phase !== 'recording') return state || idleRecording()
  return {
    phase: 'saved',
    mode: state.mode,
    startedAt: state.startedAt,
    uri: uri || null,
    note: state.mode === 'video' ? 'Video clip saved on this phone.' : 'Audio clip saved on this phone.',
  }
}

export function failRecording(state, message) {
  return {
    phase: 'idle',
    mode: state?.mode || null,
    startedAt: null,
    uri: null,
    note: message || 'Recording did not start.',
  }
}

export function recordingBlockReason({ status, permission, mode }) {
  if (!isActiveRideStatus(status)) {
    return 'Recording starts once a driver has accepted the ride.'
  }
  if (permission === 'denied') {
    return mode === 'video'
      ? 'Camera access is off. Allow the camera in Settings, then try again.'
      : 'Microphone access is off. Allow the microphone in Settings, then try again.'
  }
  return null
}

export function recordingIndicatorLabel(mode) {
  return mode === 'video' ? 'Video recording is on' : 'Audio recording is on'
}

export function preferredRecordingMime(mode, isTypeSupported) {
  const candidates = mode === 'video'
    ? ['video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4']
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  const supported = typeof isTypeSupported === 'function' ? isTypeSupported : () => false
  return candidates.find((type) => {
    try {
      return supported(type) === true
    } catch {
      return false
    }
  }) || ''
}

export function driverTrackingCopy() {
  return 'Riders see your car on the map during a trip. This phone shares location while you are online and on the ride.'
}
