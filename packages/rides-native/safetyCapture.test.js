import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  CAMERA_DENIED,
  CAMERA_NOT_READY,
  MICROPHONE_DENIED,
  backgroundLocationStatusLine,
  formatRecordingClock,
  localClipName,
  readBackgroundLocationPermission,
  recordingStatusLine,
  startAudioCapture,
  startDashcam,
  stopAudioCapture,
  stopDashcam,
  toggleDriverTripShare,
} from './safetyCapture.js'

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

function audioDouble() {
  const calls = []
  const audio = {
    granted: true,
    uri: null,
    async requestRecordingPermissionsAsync() {
      calls.push('permission')
      return { granted: audio.granted }
    },
    async setAudioModeAsync(options) {
      calls.push(['mode', options])
    },
    async prepareToRecordAsync(options) {
      calls.push(['prepare', options])
    },
    record() {
      calls.push('record')
    },
    async stop() {
      calls.push('stop')
      audio.uri = 'file:///documents/clip.m4a'
    },
  }
  return { audio, calls }
}

test('audio handler requests the microphone, starts, and stops into a local clip', async () => {
  const { audio, calls } = audioDouble()
  const started = await startAudioCapture({
    status: 'in_progress',
    recordingOptions: { quality: 'high' },
    now: () => '2026-10-13T00:00:00.000Z',
    audio,
  })
  assert.equal(started.ok, true)
  assert.equal(started.permission, 'granted')
  assert.equal(started.startedAt, '2026-10-13T00:00:00.000Z')
  assert.deepEqual(calls, [
    'permission',
    ['mode', { allowsRecording: true, playsInSilentMode: true }],
    ['prepare', { quality: 'high', directory: 'document' }],
    'record',
  ])
  const uri = await stopAudioCapture({ stop: () => audio.stop(), getUri: () => audio.uri })
  assert.equal(uri, 'file:///documents/clip.m4a')
  assert.equal(calls.at(-1), 'stop')
})

test('audio handler shows a denial and does not record', async () => {
  const { audio, calls } = audioDouble()
  audio.granted = false
  const denied = await startAudioCapture({ status: 'accepted', audio })
  assert.equal(denied.ok, false)
  assert.equal(denied.permission, 'denied')
  assert.equal(denied.error, MICROPHONE_DENIED)
  assert.equal(calls.includes('record'), false)
  assert.equal(calls.includes('prepare'), false)

  const waiting = await startAudioCapture({ status: 'searching', audio })
  assert.equal(waiting.ok, false)
  assert.match(waiting.error, /accepted/)
  assert.equal(calls.filter((call) => call === 'permission').length, 1)
})

test('audio stop reports a missing local file', async () => {
  await assert.rejects(
    stopAudioCapture({ stop: async () => {}, getUri: () => null }),
    /saved on this phone/,
  )
})

test('dashcam handler requests camera and microphone, then saves the stopped clip locally', async () => {
  const calls = []
  let resolveClip
  const pending = new Promise((resolve) => { resolveClip = resolve })
  const camera = {
    ready: true,
    async requestCameraPermissionsAsync() {
      calls.push('camera')
      return { granted: true }
    },
    async requestMicrophonePermissionsAsync() {
      calls.push('mic')
      return { granted: true }
    },
    recordAsync() {
      calls.push('record')
      return pending
    },
  }
  const started = await startDashcam({ status: 'arriving', camera, now: () => '2026-10-13T00:00:00.000Z' })
  assert.equal(started.ok, true)
  assert.equal(started.pending, pending)
  assert.deepEqual(calls, ['camera', 'mic', 'record'])
  const uri = await stopDashcam({
    stopRecording: () => {
      calls.push('stop')
      resolveClip({ uri: 'file:///cache/dash.mp4' })
    },
    pending: started.pending,
    persist: async (from) => {
      calls.push(['persist', from])
      return 'file:///documents/dash.mp4'
    },
  })
  assert.equal(uri, 'file:///documents/dash.mp4')
  assert.deepEqual(calls.slice(3), ['stop', ['persist', 'file:///cache/dash.mp4']])
})

test('dashcam denial skips recording and a missing camera does not pretend to start', async () => {
  const calls = []
  const camera = {
    ready: true,
    camGranted: false,
    micGranted: true,
    async requestCameraPermissionsAsync() {
      calls.push('camera')
      return { granted: camera.camGranted }
    },
    async requestMicrophonePermissionsAsync() {
      calls.push('mic')
      return { granted: camera.micGranted }
    },
    recordAsync() {
      calls.push('record')
      return Promise.resolve({ uri: 'file:///cache/nope.mp4' })
    },
  }
  const cameraDenied = await startDashcam({ status: 'in_progress', camera })
  assert.equal(cameraDenied.ok, false)
  assert.equal(cameraDenied.permission, 'denied')
  assert.equal(cameraDenied.error, CAMERA_DENIED)
  assert.deepEqual(calls, ['camera'])

  camera.camGranted = true
  camera.micGranted = false
  const micDenied = await startDashcam({ status: 'in_progress', camera })
  assert.equal(micDenied.error, MICROPHONE_DENIED)
  assert.equal(calls.includes('record'), false)

  camera.micGranted = true
  camera.ready = false
  const arm = await startDashcam({ status: 'accepted', camera })
  assert.equal(arm.ok, false)
  assert.equal(arm.arm, true)
  assert.equal(arm.permission, 'granted')
  assert.equal(calls.includes('record'), false)

  camera.ready = true
  camera.recordAsync = () => undefined
  const missing = await startDashcam({ status: 'accepted', camera })
  assert.equal(missing.error, CAMERA_NOT_READY)
})

test('recording clock and local clip names stay on device', () => {
  const start = '2026-10-13T00:00:00.000Z'
  assert.equal(formatRecordingClock(start, Date.parse('2026-10-13T00:01:05.000Z')), '01:05')
  assert.equal(formatRecordingClock(null, Date.parse(start)), '00:00')
  assert.equal(formatRecordingClock(start, Date.parse('2026-10-12T23:00:00.000Z')), '00:00')
  assert.match(recordingStatusLine('audio', start, Date.parse('2026-10-13T00:00:09.000Z')), /Audio recording is on · 00:09/)
  assert.match(recordingStatusLine('video', start, Date.parse(start)), /Video recording is on · 00:00/)
  assert.match(localClipName('video', new Date(start)), /^clemson-rides-video-.*\.mp4$/)
  assert.match(localClipName('audio', new Date(start)), /^clemson-rides-audio-.*\.m4a$/)
})

test('trip tracking toggle shares a live link and turning it off revokes it', async () => {
  const calls = []
  const trip = {
    id: 'trip-1',
    status: 'in_progress',
    riderId: 'rider-1',
    pickupLabel: 'Tillman',
    dropoffLabel: 'Airport',
  }
  const created = { id: 'share-1', token: 'abc', url: 'https://clemsonrides.com/share/abc', active: true }
  const on = await toggleDriverTripShare({
    enabled: true,
    trip,
    share: null,
    createShare: async (tripId, riderId) => {
      calls.push(['create', tripId, riderId])
      return created
    },
    revokeShare: async () => { throw new Error('should not revoke') },
    presentShare: async (payload) => {
      calls.push(['present', payload])
      return { action: 'sharedAction' }
    },
  })
  assert.equal(on.ok, true)
  assert.equal(on.enabled, true)
  assert.equal(on.share, created)
  assert.match(on.note, /someone you trust/)
  assert.match(calls[1][1].message, /Tillman → Airport/)
  assert.match(calls[1][1].message, /https:\/\/clemsonrides.com\/share\/abc/)
  assert.equal(calls[1][1].url, created.url)

  const again = await toggleDriverTripShare({
    enabled: true,
    trip,
    share: on.share,
    createShare: async () => { throw new Error('already sharing') },
    revokeShare: async () => { throw new Error('should not revoke') },
    presentShare: async () => ({ action: 'dismissedAction' }),
  })
  assert.equal(again.enabled, true)
  assert.match(again.note, /Share it when you are ready/)

  const off = await toggleDriverTripShare({
    enabled: false,
    trip,
    share: again.share,
    createShare: async () => { throw new Error('should not create') },
    revokeShare: async (id) => { calls.push(['revoke', id]) },
    presentShare: async () => { throw new Error('should not present') },
  })
  assert.equal(off.enabled, false)
  assert.equal(off.share, null)
  assert.deepEqual(calls.at(-1), ['revoke', 'share-1'])
})

test('trip tracking toggle stays off without an accepted ride and keeps the link if sharing is dismissed', async () => {
  let created = 0
  const early = await toggleDriverTripShare({
    enabled: true,
    trip: null,
    share: null,
    createShare: async () => { created += 1 },
    revokeShare: async () => {},
    presentShare: async () => {},
  })
  assert.equal(early.enabled, false)
  assert.match(early.error, /accepted/)
  assert.equal(created, 0)

  const noRider = await toggleDriverTripShare({
    enabled: true,
    trip: { id: 'trip-1', status: 'accepted', riderId: null },
    share: null,
    createShare: async () => { created += 1 },
    revokeShare: async () => {},
    presentShare: async () => {},
  })
  assert.match(noRider.error, /no rider/)
  assert.equal(created, 0)

  const share = { id: 'share-1', url: 'https://clemsonrides.com/share/abc' }
  const cancelled = await toggleDriverTripShare({
    enabled: true,
    trip: { id: 'trip-1', status: 'accepted', riderId: 'rider-1' },
    share,
    createShare: async () => { throw new Error('should reuse the link') },
    revokeShare: async () => { throw new Error('should not revoke') },
    presentShare: async () => { throw new Error('Share canceled') },
  })
  assert.equal(cancelled.enabled, true)
  assert.equal(cancelled.share, share)
  assert.equal(cancelled.error, undefined)

  const broken = await toggleDriverTripShare({
    enabled: true,
    trip: { id: 'trip-2', status: 'arrived', riderId: 'rider-2' },
    share: null,
    createShare: async () => { throw new Error('insert failed') },
    revokeShare: async () => {},
    presentShare: async () => {},
  })
  assert.equal(broken.enabled, false)
  assert.equal(broken.error, 'insert failed')
})

test('background location status tells the driver whether Always is granted', async () => {
  assert.match(backgroundLocationStatusLine('granted'), /Background location is granted/)
  assert.match(backgroundLocationStatusLine('denied'), /not granted/)
  assert.match(backgroundLocationStatusLine('unsupported'), /not available/)
  assert.equal(await readBackgroundLocationPermission({
    platform: 'ios',
    getBackgroundPermissionsAsync: async () => ({ status: 'granted', granted: true }),
  }), 'granted')
  assert.equal(await readBackgroundLocationPermission({
    platform: 'android',
    getBackgroundPermissionsAsync: async () => ({ status: 'denied', granted: false }),
  }), 'denied')
  assert.equal(await readBackgroundLocationPermission({
    platform: 'web',
    getBackgroundPermissionsAsync: async () => { throw new Error('nope') },
  }), 'unsupported')
  assert.equal(await readBackgroundLocationPermission({
    platform: 'ios',
    getBackgroundPermissionsAsync: async () => { throw new Error('offline') },
  }), 'unsupported')
})

test('driver safety wires recording handlers and the trip tracking share', () => {
  const capture = read('packages/rides-native/safetyCapture.js')
  const audio = read('packages/rides-native/AudioCaptureCard.jsx')
  const dashcam = read('apps/driver/components/DashcamCard.tsx')
  const tracking = read('apps/driver/components/TripTrackingCard.tsx')
  const safety = read('apps/driver/app/safety.tsx')
  const app = JSON.parse(read('apps/driver/app.json'))
  assert.doesNotMatch(capture, /fetch\(|supabase|upload\(/)
  assert.match(capture, /directory: 'document'/)
  assert.match(audio, /startAudioCapture/)
  assert.match(audio, /stopAudioCapture/)
  assert.match(audio, /requestRecordingPermissionsAsync/)
  assert.match(audio, /recordingStatusLine/)
  assert.doesNotMatch(audio, /if \(reason && !permission\) return/)
  assert.match(dashcam, /startDashcam/)
  assert.match(dashcam, /stopDashcam/)
  assert.match(dashcam, /requestCameraPermissionsAsync/)
  assert.match(dashcam, /requestMicrophonePermissionsAsync/)
  assert.match(dashcam, /facing="back"/)
  assert.match(dashcam, /mode="video"/)
  assert.match(dashcam, /keepClipOnDevice/)
  assert.match(dashcam, /accessibilityLabel=\{label\}/)
  assert.match(tracking, /toggleDriverTripShare/)
  assert.match(tracking, /createLocationShare/)
  assert.match(tracking, /revokeLocationShare/)
  assert.match(tracking, /Share live trip location/)
  assert.match(tracking, /backgroundLocationStatusLine/)
  assert.match(tracking, /Open Settings/)
  assert.match(tracking, /Linking\.openSettings/)
  assert.match(safety, /DashcamCard/)
  assert.match(safety, /TripTrackingCard/)
  assert.match(safety, /rider_id/)
  assert.doesNotMatch(safety, /VideoCaptureCard/)
  const camera = app.expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-camera')[1]
  assert.equal(camera.cameraPermission, app.expo.ios.infoPlist.NSCameraUsageDescription)
  assert.equal(camera.microphonePermission, app.expo.ios.infoPlist.NSMicrophoneUsageDescription)
  assert.equal(camera.recordAudioAndroid, true)
})
