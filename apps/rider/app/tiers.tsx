import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { SignInToBookSheet } from '@/components/SignInToBookSheet'
import { setAuthNext } from '@/lib/authNext'
import { useAuth } from '@/lib/auth'
import { oneParam } from '@/lib/oneParam'
import { formatUsd, INK, INK_SECONDARY, ORANGE, PURPLE, RIDE_TIERS, SURFACE } from 'rides-native/places.js'
import { TESLA_FLEET_NOTICE } from 'rides-native/tripTags'

export default function RideTiers() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ dest?: string; pickup?: string; note?: string }>()
  const dest = oneParam(params.dest, 'GSP Airport')
  const pickup = oneParam(params.pickup, 'Memorial Stadium · Lot 5')
  const note = oneParam(params.note)
  const { user } = useAuth()
  const [selected, setSelected] = useState(RIDE_TIERS[0].id)
  const [promptOpen, setPromptOpen] = useState(false)

  const next = {
    pathname: '/pick-driver' as const,
    params: { dest, pickup, note, tier: selected },
  }

  const onConfirm = () => {
    if (user) {
      router.push(next)
      return
    }
    setAuthNext(next)
    setPromptOpen(true)
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backLabel}>←</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>To {dest}</Text>
          <Text style={styles.sub}>Pickup {pickup}</Text>
        </View>
      </View>
      <View style={styles.promo}>
        <Text style={styles.promoText}>🐯 Clemson student promo · 10% off Standard</Text>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        {RIDE_TIERS.map((tier) => {
          const on = tier.id === selected
          return (
            <Pressable key={tier.id} onPress={() => setSelected(tier.id)} style={[styles.row, on && styles.rowOn]}>
              <Text style={styles.icon}>{tier.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{tier.name}</Text>
                <Text style={styles.meta}>{tier.eta} · {tier.meta}</Text>
              </View>
              <Text style={styles.price}>{formatUsd(tier.price)}</Text>
            </Pressable>
          )
        })}
      </ScrollView>
      {selected === 'tesla' ? (
        <View style={styles.stub}>
          <Text style={styles.stubText}>{TESLA_FLEET_NOTICE}</Text>
        </View>
      ) : null}
      <View style={styles.footer}>
        <PrimaryButton label="Choose a driver" onPress={onConfirm} />
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
  kicker: { fontSize: 18, fontWeight: '700', color: INK },
  sub: { color: INK_SECONDARY, fontSize: 13, marginTop: 2 },
  promo: {
    marginHorizontal: 16,
    marginBottom: 8,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(82,45,128,0.08)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  promoText: { color: PURPLE, fontWeight: '600', fontSize: 12 },
  list: { padding: 16, paddingBottom: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowOn: { borderColor: ORANGE },
  icon: { fontSize: 22 },
  name: { fontWeight: '700', fontSize: 16, color: INK },
  meta: { color: INK_SECONDARY, fontSize: 12, marginTop: 2 },
  price: { fontWeight: '800', color: INK, fontSize: 16 },
  footer: { padding: 16, paddingBottom: 28, backgroundColor: '#fff' },
  stub: { marginHorizontal: 16, marginBottom: 8, backgroundColor: 'rgba(245,102,0,0.12)', borderRadius: 16, padding: 12 },
  stubText: { color: PURPLE, fontSize: 13, lineHeight: 18, fontWeight: '600' },
})
