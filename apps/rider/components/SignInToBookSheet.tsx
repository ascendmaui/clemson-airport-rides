import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { PrimaryButton, SheetHandle } from '@/components/Button'
import { INK_SECONDARY, PURPLE } from 'rides-native/places.js'

export function SignInToBookSheet({
  open,
  onClose,
  onSignIn,
  onSignUp,
}: {
  open: boolean
  onClose: () => void
  onSignIn: () => void
  onSignUp: () => void
}) {
  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <SheetHandle />
          <View style={styles.badge}>
            <Text style={styles.badgeText}>🐯</Text>
          </View>
          <Text style={styles.title}>Sign in to book your ride</Text>
          <Text style={styles.body}>
            Browse freely — login is only needed when you request a ride or pay the 25% deposit.
          </Text>
          <PrimaryButton label="Sign in" onPress={onSignIn} />
          <Pressable onPress={onSignUp} style={styles.link}>
            <Text style={styles.linkText}>Create account</Text>
          </Pressable>
          <Pressable onPress={onClose} style={styles.quiet}>
            <Text style={styles.quietText}>Keep browsing</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(11,18,32,0.42)' },
  sheet: {
    margin: 12,
    marginBottom: 24,
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 22,
  },
  badge: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(82,45,128,0.1)',
    marginBottom: 14,
  },
  badgeText: { fontSize: 22 },
  title: { fontSize: 22, fontWeight: '700', color: '#0B1220', letterSpacing: -0.4 },
  body: { marginTop: 8, marginBottom: 18, color: INK_SECONDARY, fontSize: 14, lineHeight: 20 },
  link: { paddingVertical: 12, alignItems: 'center' },
  linkText: { color: PURPLE, fontWeight: '700', fontSize: 16 },
  quiet: { paddingVertical: 8, alignItems: 'center' },
  quietText: { color: '#8B939E', fontSize: 13, fontWeight: '500' },
})
