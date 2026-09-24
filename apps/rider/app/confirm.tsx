import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton, SheetHandle } from '@/components/Button'
import { CampusMap } from '@/components/CampusMap'
import { SignInToBookSheet } from '@/components/SignInToBookSheet'
import { setAuthNext } from '@/lib/authNext'
import { useAuth } from '@/lib/auth'
import { oneParam } from '@/lib/oneParam'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

export default function ConfirmPickup() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ dest?: string }>()
  const dest = oneParam(params.dest, 'GSP Airport')
  const { user } = useAuth()
  const [address, setAddress] = useState('Memorial Stadium · Lot 5')
  const [note, setNote] = useState('')
  const [promptOpen, setPromptOpen] = useState(false)
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)

  const goTiers = () => {
    router.push({ pathname: '/tiers', params: { dest, pickup: address, note } })
  }

  const onConfirm = () => {
    if (user) {
      goTiers()
      return
    }
    setAuthNext({ pathname: '/tiers', params: { dest, pickup: address, note } })
    setPromptOpen(true)
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={[styles.back, lift(colors, 'rest')]}>
          <Text style={styles.backLabel}>←</Text>
        </Pressable>
        <Text style={styles.title}>Confirm pickup spot</Text>
      </View>
      <View style={styles.map}>
        <CampusMap spots={[]} showHeat={false} />
      </View>
      <Text style={styles.hint}>Pin stays on Memorial Stadium. Drag-to-adjust ships with live tracking.</Text>
      <View style={[styles.sheet, lift(colors, 'float')]}>
        <SheetHandle />
        <Text style={styles.fieldLabel}>Pickup address</Text>
        <TextInput value={address} onChangeText={setAddress} style={styles.input} />
        <Text style={styles.fieldLabel}>Add note for driver</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="e.g. Near the orange gates, wearing purple hoodie"
          placeholderTextColor={colors.placeholder}
          style={[styles.input, styles.note]}
          multiline
        />
        <Text style={styles.going}>
          Going to <Text style={styles.goingStrong}>{dest}</Text>
        </Text>
        <PrimaryButton label="Confirm pickup" onPress={onConfirm} />
      </View>
      <SignInToBookSheet
        open={promptOpen}
        onClose={() => setPromptOpen(false)}
        onSignIn={() => {
          setPromptOpen(false)
          router.push('/sign-in')
        }}
        onSignUp={() => {
          setPromptOpen(false)
          router.push('/sign-up')
        }}
      />
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    screen: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
    back: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.card, alignItems: 'center' as const, justifyContent: 'center' as const },
    backLabel: { fontSize: 18, color: colors.title, fontWeight: '700' as const },
    title: { fontSize: 20, fontWeight: '600' as const, color: colors.ink },
    map: { height: 260, marginHorizontal: 16, borderRadius: 18, overflow: 'hidden' as const },
    hint: { textAlign: 'center' as const, color: colors.placeholder, fontSize: 12, marginTop: 8 },
    sheet: {
      marginTop: 'auto' as const,
      backgroundColor: colors.card,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 20,
      paddingBottom: 28,
    },
    fieldLabel: { fontSize: 13, fontWeight: '600' as const, color: colors.inkSecondary, marginBottom: 6 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 14,
      fontSize: 16,
      color: colors.ink,
      backgroundColor: colors.input,
    },
    note: { minHeight: 64, textAlignVertical: 'top' as const },
    going: { fontSize: 13, color: colors.inkSecondary, marginBottom: 14 },
    goingStrong: { color: colors.ink, fontWeight: '700' as const },
  }
}
