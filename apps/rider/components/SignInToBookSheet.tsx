import { Modal, Pressable, Text, View } from 'react-native'
import { PrimaryButton, SheetHandle } from '@/components/Button'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

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
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, lift(colors, 'float')]} onPress={() => undefined}>
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

function makeStyles(colors: Palette) {
  return {
    backdrop: { flex: 1, justifyContent: 'flex-end' as const, backgroundColor: colors.scrim },
    sheet: {
      margin: 12,
      marginBottom: 24,
      backgroundColor: colors.card,
      borderRadius: 24,
      padding: 22,
    },
    badge: {
      width: 48,
      height: 48,
      borderRadius: 14,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      backgroundColor: colors.purpleSoft,
      marginBottom: 14,
    },
    badgeText: { fontSize: 22 },
    title: { fontSize: 22, fontWeight: '700' as const, color: colors.title, letterSpacing: -0.4 },
    body: { marginTop: 8, marginBottom: 18, color: colors.inkSecondary, fontSize: 14, lineHeight: 20 },
    link: { paddingVertical: 12, alignItems: 'center' as const },
    linkText: { color: colors.link, fontWeight: '700' as const, fontSize: 16 },
    quiet: { paddingVertical: 8, alignItems: 'center' as const },
    quietText: { color: colors.placeholder, fontSize: 13, fontWeight: '500' as const },
  }
}
