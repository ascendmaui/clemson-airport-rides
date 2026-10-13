import { Camera, CameraView } from 'expo-camera'
import { useEffect, useRef, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import {
  failRecording,
  finishRecording,
  idleRecording,
  recordingBlockReason,
} from '../../../shared/safetyHub.js'
import {
  CAMERA_NOT_READY,
  localClipName,
  recordingStatusLine,
  startDashcam,
  stopDashcam,
} from 'rides-native/safetyCapture.js'
import { keepClipOnDevice } from '@/lib/localClip'
import { useTheme } from '@/lib/theme'

type CaptureSession = {
  phase: string
  mode: string | null
  startedAt: string | null
  uri: string | null
  note: string | null
}

export function DashcamCard({ status, active = true }: { status: string | null; active?: boolean }) {
  const { colors } = useTheme()
  const cameraRef = useRef<CameraView | null>(null)
  const pendingRef = useRef<Promise<{ uri?: string } | undefined> | null>(null)
  const armRef = useRef(false)
  const busyRef = useRef(false)
  const recordingRef = useRef(false)
  const endRef = useRef<() => Promise<void>>(async () => {})
  const [session, setSession] = useState<CaptureSession>(idleRecording())
  const [permission, setPermission] = useState('unknown')
  const [preview, setPreview] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [arming, setArming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const recording = session.phase === 'recording'
  recordingRef.current = recording
  const blocked = recordingBlockReason({ status, permission, mode: 'video' })

  useEffect(() => {
    let alive = true
    Promise.all([Camera.getCameraPermissionsAsync(), Camera.getMicrophonePermissionsAsync()])
      .then(([cam, mic]) => {
        if (!alive) return
        if (cam.granted && mic.granted) {
          setPreview(true)
          setPermission('granted')
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!recording) return undefined
    setNow(Date.now())
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(clock)
  }, [recording])

  useEffect(() => () => {
    const pending = pendingRef.current
    if (!pending) return
    pendingRef.current = null
    try { cameraRef.current?.stopRecording() } catch { /* already stopped */ }
    void pending.then((result) => {
      if (!result?.uri) return
      try { keepClipOnDevice(result.uri, localClipName('video')) } catch { /* cache copy remains on this phone */ }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (active || !recordingRef.current) return
    void endRef.current()
  }, [active])

  async function begin(ready = cameraReady) {
    const result = await startDashcam({
      status,
      camera: {
        requestCameraPermissionsAsync: () => Camera.requestCameraPermissionsAsync(),
        requestMicrophonePermissionsAsync: () => Camera.requestMicrophonePermissionsAsync(),
        ready,
        recordAsync: () => cameraRef.current?.recordAsync(),
      },
    })
    if (result.permission) setPermission(result.permission)
    if (result.permission === 'granted') setPreview(true)
    if (result.ok) {
      armRef.current = false
      setArming(false)
      pendingRef.current = result.pending
      void result.pending.catch(() => {})
      setSession({ phase: 'recording', mode: 'video', startedAt: result.startedAt, uri: null, note: null })
      return
    }
    if (result.arm) {
      armRef.current = true
      setArming(true)
      return
    }
    armRef.current = false
    setArming(false)
    setSession((current) => failRecording(current, result.error || CAMERA_NOT_READY))
  }

  async function end() {
    const pending = pendingRef.current
    pendingRef.current = null
    try {
      const uri = await stopDashcam({
        stopRecording: () => cameraRef.current?.stopRecording(),
        pending,
        persist: (from: string) => {
          try {
            return keepClipOnDevice(from, localClipName('video'))
          } catch {
            return from
          }
        },
      })
      setSession((current) => finishRecording(current, uri))
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Could not stop video'
      setSession((current) => failRecording(current, text))
    }
  }
  endRef.current = end

  async function onPress() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      if (recording) await end()
      else await begin()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  function onCameraReady() {
    setCameraReady(true)
    if (!armRef.current || busyRef.current) return
    armRef.current = false
    busyRef.current = true
    setBusy(true)
    void begin(true).finally(() => {
      busyRef.current = false
      setBusy(false)
    })
  }

  const label = recording ? 'Stop video' : 'Record video'
  const statusLine = recording ? recordingStatusLine('video', session.startedAt, now) : null

  return (
    <View style={{ gap: 10 }}>
      {preview && (active || recording) ? (
        <View accessibilityLabel="Dashcam preview" style={{ height: 220, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.title }}>
          <CameraView
            ref={cameraRef}
            style={{ flex: 1 }}
            facing="back"
            mode="video"
            mute={false}
            onCameraReady={onCameraReady}
          />
          {statusLine ? (
            <View
              accessibilityLiveRegion="polite"
              accessibilityLabel={statusLine}
              style={{ position: 'absolute', top: 10, left: 10, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }}
            >
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.orange }} />
              <Text style={{ color: colors.onAccent, fontWeight: '800' }}>{statusLine}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {arming && !recording ? (
        <Text style={{ color: colors.inkSecondary, fontSize: 13 }}>Starting the dashcam…</Text>
      ) : null}
      {!recording && session.note ? (
        <Text accessibilityLiveRegion="polite" style={{ color: session.phase === 'saved' ? colors.inkSecondary : colors.danger, fontSize: 13, lineHeight: 18 }}>
          {session.note}
        </Text>
      ) : null}
      {!recording && !session.note && blocked ? (
        <Text style={{ color: colors.inkSecondary, fontSize: 13, lineHeight: 18 }}>{blocked}</Text>
      ) : null}
      <Text style={{ color: colors.inkSecondary, fontSize: 13, lineHeight: 18 }}>
        Dashcam records from the rear camera. The clip stays on this phone and is not uploaded.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={() => { void onPress() }}
        style={{
          backgroundColor: recording ? colors.purple : colors.orange,
          borderRadius: 14,
          minHeight: 48,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: busy ? 0.7 : 1,
        }}
      >
        <Text style={{ color: colors.onAccent, fontWeight: '800' }}>{label}</Text>
      </Pressable>
    </View>
  )
}
