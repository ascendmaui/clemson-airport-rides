import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { SignInToBookSheet } from '@/components/SignInToBookSheet'
import { setAuthNext } from '@/lib/authNext'
import { useAuth } from '@/lib/auth'
import { oneParam } from '@/lib/oneParam'
import { formatUsd, RIDE_TIERS } from 'rides-native/places.js'
import { STUDENT_DISCOUNT_LABEL, displayTierPrice } from 'rides-native/riderMoney.js'
import { useStudentStatus } from '@/lib/useStudentStatus'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'
import { TESLA_FLEET_NOTICE } from 'rides-native/tripTags'

export default function RideTiers() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ dest?: string; pickup?: string; note?: string }>()
  const dest = oneParam(params.dest, 'GSP Airport')
  const pickup = oneParam(params.pickup, 'Memorial Stadium · Lot 5')
  const note = oneParam(params.note)
  const { user } = useAuth()
  const student = useStudentStatus()
  const [selected, setSelected] = useState(RIDE_TIERS[0].id)
  const [promptOpen, setPromptOpen] = useState(false)
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)

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
        <Pressable onPress={() => router.back()} style={[styles.back, lift(colors, 'rest')]}>
          <Text style={styles.backLabel}>←</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>To {dest}</Text>
          <Text style={styles.sub}>Pickup {pickup}</Text>
        </View>
      </View>
      <Pressable onPress={() => router.push(user ? '/student' : '/sign-in')} style={styles.promo} accessibilityRole="button">
        <Text style={styles.promoText}>
          {student.verified ? `🐯 ${STUDENT_DISCOUNT_LABEL}` : '🐯 Claim Clemson student pricing · 10% off Standard'}
        </Text>
      </Pressable>
      <ScrollView contentContainerStyle={styles.list}>
        {RIDE_TIERS.map((tier) => {
          const on = tier.id === selected
          const quoted = displayTierPrice(tier.price, { isStudent: student.verified, tier: tier.id })
          return (
            <Pressable key={tier.id} onPress={() => setSelected(tier.id)} style={[styles.row, tier.id === 'tesla' && styles.rowFleet, on && styles.rowOn]}>
              <Text style={styles.icon}>{tier.icon}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{tier.name}</Text>
                {tier.id === 'tesla' ? <Text style={styles.fleetBadge}>Clemson fleet</Text> : null}
                <Text style={styles.meta}>{tier.eta} · {tier.meta}</Text>
                {quoted.label ? <Text style={styles.discount}>{quoted.label}</Text> : null}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.price}>{formatUsd(quoted.price)}</Text>
                {quoted.discount > 0 ? <Text style={styles.was}>{formatUsd(tier.price)}</Text> : null}
              </View>
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
        <PrimaryButton label={selected === 'tesla' ? 'Request Tesla Model 3' : 'Choose a driver'} onPress={onConfirm} tone={selected === 'tesla' ? 'purple' : 'orange'} />
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
    kicker: { fontSize: 18, fontWeight: '700' as const, color: colors.ink },
    sub: { color: colors.inkSecondary, fontSize: 13, marginTop: 2 },
    promo: {
      marginHorizontal: 16,
      marginBottom: 8,
      alignSelf: 'flex-start' as const,
      backgroundColor: colors.purpleSoft,
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    promoText: { color: colors.link, fontWeight: '600' as const, fontSize: 12 },
    list: { padding: 16, paddingBottom: 24 },
    row: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 12,
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 14,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    rowOn: { borderColor: colors.orange, backgroundColor: colors.orangeSoft },
    rowFleet: { borderColor: colors.purple, backgroundColor: colors.purpleSoft },
    fleetBadge: {
      alignSelf: 'flex-start' as const,
      marginTop: 4,
      color: colors.orange,
      backgroundColor: colors.card,
      fontSize: 10,
      fontWeight: '800' as const,
      letterSpacing: 0.4,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 999,
      overflow: 'hidden' as const,
    },
    icon: { fontSize: 22 },
    name: { fontWeight: '700' as const, fontSize: 16, color: colors.ink },
    meta: { color: colors.inkSecondary, fontSize: 12, marginTop: 2 },
    price: { fontWeight: '800' as const, color: colors.ink, fontSize: 16 },
    was: { color: colors.inkSecondary, fontSize: 11, textDecorationLine: 'line-through' as const },
    discount: { color: colors.orange, fontSize: 11, fontWeight: '700' as const, marginTop: 2 },
    footer: { padding: 16, paddingBottom: 28, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border },
    stub: { marginHorizontal: 16, marginBottom: 8, backgroundColor: colors.orangeSoft, borderRadius: 16, padding: 12 },
    stubText: { color: colors.link, fontSize: 13, lineHeight: 18, fontWeight: '600' as const },
  }
}
