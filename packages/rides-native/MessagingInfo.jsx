import { useState } from 'react'
import { Modal, Pressable, Text, View } from 'react-native'
import { messagingGuide } from '../../shared/copy/messaging.js'

function GuideBody({ guide, tone }) {
  return (
    <>
      <Text style={{ color: tone.title, fontSize: 22, fontWeight: '800', marginTop: 8 }}>{guide.title}</Text>
      <View style={{ gap: 8, marginTop: 12 }}>
        {guide.summary.map((line, index) => (
          <Text key={line} style={{ color: tone.ink, fontSize: 15, lineHeight: 21 }}>
            {`${index + 1}. ${line}`}
          </Text>
        ))}
      </View>
      <Text style={{ color: tone.title, fontSize: 16, fontWeight: '800', marginTop: 18 }}>{guide.lostItemTitle}</Text>
      <View style={{ gap: 8, marginTop: 8 }}>
        {guide.lostItemSteps.map((line, index) => (
          <Text key={line} style={{ color: tone.ink, fontSize: 15, lineHeight: 21 }}>
            {`${index + 1}. ${line}`}
          </Text>
        ))}
      </View>
    </>
  )
}

export function MessagingInfoButton({ role, colors }) {
  const [open, setOpen] = useState(false)
  const guide = messagingGuide(role === 'driver' ? 'driver' : 'rider')
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
          borderColor: tone.border || 'rgba(255,255,255,0.16)',
          backgroundColor: tone.elevated || tone.card,
        }}
      >
        <Text style={{ color: tone.title || tone.ink, fontWeight: '800', fontSize: 16 }}>i</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close how messaging works"
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
            }}
          >
            <GuideBody guide={guide} tone={tone} />
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
