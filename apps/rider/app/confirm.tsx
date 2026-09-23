import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton, SheetHandle } from '@/components/Button'
import { CampusMap } from '@/components/CampusMap'
import { SignInToBookSheet } from '@/components/SignInToBookSheet'
import { setAuthNext } from '@/lib/authNext'
import { useAuth } from '@/lib/auth'
import { oneParam } from '@/lib/oneParam'
import { INK, INK_SECONDARY, PURPLE, SURFACE } from 'rides-native/places.js'

export default function ConfirmPickup() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ dest?: string }>()
  const dest = oneParam(params.dest, 'GSP Airport')
  const { user } = useAuth()
  const [address, setAddress] = useState('Memorial Stadium · Lot 5')
  const [note, setNote] = useState('')
  const [promptOpen, setPromptOpen] = useState(false)

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
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backLabel}>←</Text>
        </Pressable>
        <Text style={styles.title}>Confirm pickup spot</Text>
      </View>
      <View style={styles.map}>
        <CampusMap spots={[]} showHeat={false} />
      </View>
      <Text style={styles.hint}>Pin stays on Memorial Stadium. Drag-to-adjust ships with live tracking.</Text>
      <View style={styles.sheet}>
        <SheetHandle />
        <Text style={styles.fieldLabel}>Pickup address</Text>
        <TextInput value={address} onChangeText={setAddress} style={styles.input} />
        <Text style={styles.fieldLabel}>Add note for driver</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="e.g. Near the orange gates, wearing purple hoodie"
          placeholderTextColor="#8B939E"
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SURFACE },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  back: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  backLabel: { fontSize: 18, color: PURPLE, fontWeight: '700' },
  title: { fontSize: 20, fontWeight: '600', color: INK },
  map: { height: 260, marginHorizontal: 16, borderRadius: 18, overflow: 'hidden' },
  hint: { textAlign: 'center', color: '#8B939E', fontSize: 12, marginTop: 8 },
  sheet: {
    marginTop: 'auto',
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 28,
  },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: INK_SECONDARY, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(82,45,128,0.16)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
    fontSize: 16,
    color: INK,
  },
  note: { minHeight: 64, textAlignVertical: 'top' },
  going: { fontSize: 13, color: INK_SECONDARY, marginBottom: 14 },
  goingStrong: { color: INK, fontWeight: '700' },
})
