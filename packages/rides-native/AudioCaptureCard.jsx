import { useEffect, useRef, useState } from 'react'
import { Animated, Pressable, Text, View } from 'react-native'
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio'
import {
  beginRecording,
  failRecording,
  finishRecording,
  idleRecording,
  recordingBlockReason,
} from '../../shared/safetyHub.js'
import { recordingStatusLine, startAudioCapture, stopAudioCapture } from './safetyCapture.js'

export function AudioCaptureCard({ status, colors }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const recorderRef = useRef(recorder)
  recorderRef.current = recorder
  const [session, setSession] = useState(idleRecording)
  const [permission, setPermission] = useState('unknown')
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const pulse = useRef(new Animated.Value(0.4)).current
  const blocked = recordingBlockReason({ status, permission, mode: 'audio' })
  const recording = session.phase === 'recording'

  useEffect(() => {
    if (!recording) {
      pulse.setValue(0.4)
      return undefined
    }
    setNow(Date.now())
    const clock = setInterval(() => setNow(Date.now()), 1000)
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.35, duration: 700, useNativeDriver: true }),
    ]))
    loop.start()
    return () => {
      clearInterval(clock)
      loop.stop()
    }
  }, [pulse, recording])

  useEffect(() => () => {
    const current = recorderRef.current
    try {
      const stopped = current?.stop?.()
      if (stopped && typeof stopped.then === 'function') stopped.catch(() => {})
    } catch {
      /* already stopped */
    }
  }, [])

  async function onPress() {
    if (busy) return
    setBusy(true)
    try {
      if (recording) {
        try {
          const uri = await stopAudioCapture({
            stop: () => recorder.stop(),
            getUri: () => recorder.uri,
          })
          setSession((current) => finishRecording(current, uri))
        } catch (err) {
          const text = err?.message || 'Could not stop audio'
          setSession((current) => failRecording(current, text))
        }
        return
      }
      const result = await startAudioCapture({
        status,
        recordingOptions: RecordingPresets.HIGH_QUALITY,
        audio: {
          requestRecordingPermissionsAsync: () => AudioModule.requestRecordingPermissionsAsync(),
          setAudioModeAsync,
          prepareToRecordAsync: (options) => recorder.prepareToRecordAsync(options),
          record: () => recorder.record(),
        },
      })
      if (result.permission) setPermission(result.permission)
      if (!result.ok) {
        setSession((current) => failRecording(current, result.error))
        return
      }
      setSession(beginRecording(idleRecording(), 'audio', result.startedAt))
    } finally {
      setBusy(false)
    }
  }

  const label = recording ? 'Stop audio' : 'Record audio'
  const statusLine = recording ? recordingStatusLine('audio', session.startedAt, now) : null

  return (
    <View style={{ gap: 10 }}>
      {recording ? (
        <Animated.View
          accessibilityLiveRegion="polite"
          accessibilityLabel={statusLine}
          style={{ opacity: pulse, flexDirection: 'row', alignItems: 'center', gap: 8 }}
        >
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.orange }} />
          <Text style={{ color: colors.orange, fontWeight: '800' }}>{statusLine}</Text>
        </Animated.View>
      ) : null}
      {!recording && session.note ? (
        <Text accessibilityLiveRegion="polite" style={{ color: session.phase === 'saved' ? colors.inkSecondary : colors.danger, fontSize: 13, lineHeight: 18 }}>
          {session.note}
        </Text>
      ) : null}
      {!recording && !session.note && blocked ? (
        <Text style={{ color: colors.inkSecondary, fontSize: 13, lineHeight: 18 }}>{blocked}</Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={onPress}
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
