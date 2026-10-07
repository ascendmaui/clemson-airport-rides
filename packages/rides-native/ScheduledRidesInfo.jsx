import { useEffect, useState } from 'react'
import { Modal, Pressable, Text, View } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import {
  scheduledRidesExplainerKey,
  scheduledRidesGuide,
  scheduledRidesTopic,
} from '../../shared/copy/scheduledRides.js'

function NumberedLines({ lines, color }) {
  return (
    <View style={{ gap: 8, marginTop: 12 }}>
      {lines.map((line, index) => (
        <Text key={line} style={{ color: color || '#241c33', fontSize: 15, lineHeight: 21 }}>
          {`${index + 1}. ${line}`}
        </Text>
      ))}
    </View>
  )
}

export function ScheduledRidesInfoButton({ topic, colors }) {
  const [open, setOpen] = useState(false)
  const guide = scheduledRidesTopic(topic)
  const tone = colors || {}
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={guide.infoLabel}
        onPress={() => setOpen(true)}
        hitSlop={8}
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: tone.border || 'rgba(82,45,128,0.2)',
          backgroundColor: tone.elevated || tone.card || '#fff',
        }}
      >
        <Text style={{ color: tone.title || tone.ink || '#241c33', fontWeight: '800', fontSize: 16 }}>i</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={() => setOpen(false)}
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(20,16,28,0.45)' }}
          />
          <View
            style={{
              backgroundColor: tone.card || '#fff',
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              paddingHorizontal: 20,
              paddingTop: 12,
              paddingBottom: 28,
              maxHeight: '80%',
            }}
          >
            <Text style={{ color: tone.title || '#241c33', fontSize: 22, fontWeight: '800', marginTop: 8 }}>{guide.title}</Text>
            <NumberedLines lines={guide.steps} color={tone.ink} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Got it"
              onPress={() => setOpen(false)}
              style={{
                marginTop: 18,
                minHeight: 48,
                borderRadius: 14,
                backgroundColor: tone.orange || '#F56600',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: tone.onAccent || '#fff', fontWeight: '800' }}>Got it</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  )
}

export function ScheduledRidesHint({ topic, colors }) {
  const guide = scheduledRidesTopic(topic)
  const tone = colors || {}
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 8 }}>
      <Text style={{ flex: 1, color: tone.inkSecondary || '#5c5468', fontSize: 13, lineHeight: 18, marginTop: 10 }}>{guide.helper}</Text>
      <ScheduledRidesInfoButton topic={topic} colors={colors} />
    </View>
  )
}

export function ScheduledRidesExplainer({ role, colors }) {
  const guide = scheduledRidesGuide(role === 'driver' ? 'driver' : 'rider')
  const tone = colors || {}
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let alive = true
    SecureStore.getItemAsync(scheduledRidesExplainerKey(role))
      .then((value) => {
        if (alive && value !== '1') setOpen(true)
      })
      .catch(() => {
        if (alive) setOpen(true)
      })
    return () => {
      alive = false
    }
  }, [role])
  if (!open) return null
  function dismiss() {
    setOpen(false)
    SecureStore.setItemAsync(scheduledRidesExplainerKey(role), '1').catch(() => {})
  }
  return (
    <View
      style={{
        marginBottom: 12,
        padding: 12,
        borderRadius: 14,
        backgroundColor: tone.purpleSoft || 'rgba(82,45,128,0.08)',
        borderWidth: 1,
        borderColor: 'rgba(82,45,128,0.18)',
      }}
    >
      <Text style={{ color: tone.purple || '#522D80', fontWeight: '800', fontSize: 16 }}>{guide.title}</Text>
      <NumberedLines lines={guide.summary} color={tone.ink} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Got it"
        onPress={dismiss}
        style={{
          marginTop: 12,
          minHeight: 44,
          borderRadius: 12,
          backgroundColor: tone.orange || '#F56600',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: tone.onAccent || '#fff', fontWeight: '800' }}>Got it</Text>
      </Pressable>
    </View>
  )
}
