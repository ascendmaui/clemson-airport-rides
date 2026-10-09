import { useEffect, useRef, useState } from 'react'
import { Animated, Pressable, Text, View } from 'react-native'
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio'
import {
  beginRecording,
  failRecording,
  finishRecording,
  idleRecording,
  recordingBlockReason,
  recordingIndicatorLabel,
} from '../../shared/safetyHub.js'

export function AudioCaptureCard({ status, colors }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const [session, setSession] = useState(idleRecording)
  const [permission, setPermission] = useState('unknown')
  const pulse = useRef(new Animated.Value(0.4)).current
  const blocked = recordingBlockReason({ status, permission, mode: 'audio' })
  const recording = session.phase === 'recording'

  useEffect(() => {
    if (!recording) {
      pulse.setValue(0.4)
      return undefined
    }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.35, duration: 700, useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [pulse, recording])

  useEffect(() => () => {
    try { recorder.stop() } catch { /* already stopped */ }
  }, [recorder])

  async function onPress() {
    if (recording) {
      try {
        await recorder.stop()
        setSession((current) => finishRecording(current, recorder.uri || null))
      } catch (err) {
        setSession((current) => failRecording(current, err?.message || 'Could not stop audio'))
      }
      return
    }
    const reason = recordingBlockReason({ status, permission, mode: 'audio' })
    if (reason && permission === 'denied') {
      setSession((current) => failRecording(current, reason))
      return
    }
    if (reason && !permission) return
    if (recordingBlockReason({ status, permission: 'granted', mode: 'audio' })) {
      setSession((current) => failRecording(current, recordingBlockReason({ status, permission: 'granted', mode: 'audio' })))
      return
    }
    try {
      const statusResult = await AudioModule.requestRecordingPermissionsAsync()
      if (!statusResult?.granted) {
        setPermission('denied')
        setSession((current) => failRecording(current, 'Microphone access is off. Allow the microphone in Settings, then try again.'))
        return
      }
      setPermission('granted')
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
      await recorder.prepareToRecordAsync()
      recorder.record()
      setSession(beginRecording(idleRecording(), 'audio', new Date().toISOString()))
    } catch (err) {
      setSession((current) => failRecording(current, err?.message || 'Could not start audio'))
    }
  }

  const label = recording ? 'Stop audio' : 'Record audio'

  return (
    <View style={{ gap: 10 }}>
      {recording ? (
        <Animated.View style={{ opacity: pulse, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.orange }} />
          <Text style={{ color: colors.orange, fontWeight: '800' }}>{recordingIndicatorLabel('audio')}</Text>
        </Animated.View>
      ) : null}
      {blocked && !recording ? <Text style={{ color: colors.inkSecondary, fontSize: 13, lineHeight: 18 }}>{blocked}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={Boolean(blocked) && !recording}
        onPress={onPress}
        style={{
          backgroundColor: recording ? colors.purple : colors.orange,
          borderRadius: 14,
          minHeight: 48,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: blocked && !recording ? 0.45 : 1,
        }}
      >
        <Text style={{ color: colors.onAccent, fontWeight: '800' }}>{label}</Text>
      </Pressable>
      {session.note ? <Text style={{ color: colors.inkSecondary, fontSize: 13 }}>{session.note}</Text> : null}
    </View>
  )
}
