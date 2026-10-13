import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { motion, radius, type as typeScale } from './shared/theme.js'
import * as ImagePicker from 'expo-image-picker'
import {
  failRecording,
  finishRecording,
  idleRecording,
  recordingBlockReason,
} from '../../shared/safetyHub.js'

export function VideoCaptureCard({ status, colors }) {
  const [session, setSession] = useState(idleRecording)
  const [permission, setPermission] = useState('unknown')
  const blocked = recordingBlockReason({ status, permission, mode: 'video' })

  async function onPress() {
    const waiting = recordingBlockReason({ status, permission: 'granted', mode: 'video' })
    if (waiting) {
      setSession(failRecording(session, waiting))
      return
    }
    try {
      const cam = await ImagePicker.requestCameraPermissionsAsync()
      if (!cam?.granted) {
        setPermission('denied')
        setSession(failRecording(session, 'Camera access is off. Allow the camera in Settings, then try again.'))
        return
      }
      setPermission('granted')
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions?.Videos || ['videos'],
        videoMaxDuration: 60,
      })
      if (result?.canceled) {
        setSession(failRecording(idleRecording(), 'Video recording was canceled.'))
        return
      }
      const uri = result?.assets?.[0]?.uri || null
      setSession(finishRecording({ phase: 'recording', mode: 'video', startedAt: new Date().toISOString(), uri: null, note: null }, uri))
    } catch (err) {
      setSession(failRecording(session, err?.message || 'Could not record video'))
    }
  }

  return (
    <View style={{ gap: 10 }}>
      {blocked ? <Text style={{ color: colors.inkSecondary, fontSize: 13, lineHeight: 18 }}>{blocked}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Record video"
        disabled={Boolean(blocked)}
        onPress={onPress}
        style={{
          backgroundColor: colors.purple,
          borderRadius: radius.lg,
          minHeight: 52,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: blocked ? motion.disabledOpacity : 1,
        }}
      >
        <Text style={{ color: colors.onAccent, ...typeScale.button }}>Record video</Text>
      </Pressable>
      {session.note ? <Text style={{ color: colors.inkSecondary, fontSize: 13, lineHeight: 18 }}>{session.note}</Text> : null}
    </View>
  )
}
