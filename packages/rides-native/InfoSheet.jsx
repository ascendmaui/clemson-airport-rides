import { Modal, Pressable, ScrollView, Text, View } from 'react-native'

const ORANGE = '#F56600'
const PURPLE = '#522D80'

export function InfoButton({ label, onPress, colors }) {
  const tone = colors || {}
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: tone.border || 'rgba(82,45,128,0.2)',
        backgroundColor: tone.elevated || tone.card || '#FFFFFF',
      }}
    >
      <Text style={{ color: tone.title || tone.purple || PURPLE, fontWeight: '800', fontSize: 16 }}>i</Text>
    </Pressable>
  )
}

export function InfoSheet({ open, onClose, colors, title, closeLabel, children }) {
  const tone = colors || {}
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeLabel || 'Close'}
          onPress={onClose}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            backgroundColor: tone.scrim || 'rgba(20,16,28,0.45)',
          }}
        />
        <View
          style={{
            backgroundColor: tone.card || '#FFFFFF',
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            paddingHorizontal: 20,
            paddingTop: 12,
            paddingBottom: 28,
            maxHeight: '80%',
          }}
        >
          <Text style={{ color: tone.title || tone.purple || PURPLE, fontSize: 22, fontWeight: '800', marginTop: 8 }}>{title}</Text>
          <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingBottom: 4 }}>
            {children}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Got it"
            onPress={onClose}
            style={{
              marginTop: 18,
              minHeight: 48,
              borderRadius: 14,
              backgroundColor: tone.orange || ORANGE,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ color: tone.onAccent || '#FFFFFF', fontWeight: '800' }}>Got it</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}
