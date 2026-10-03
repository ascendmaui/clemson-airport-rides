import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { Animated, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { pressStyle, useEnterMotion } from '@/components/enter'
import { SignInToBookSheet } from '@/components/SignInToBookSheet'
import { setAuthNext } from '@/lib/authNext'
import { useAuth } from '@/lib/auth'
import { oneParam } from '@/lib/oneParam'
import { formatUsd, RIDE_TIERS } from 'rides-native/places.js'
import { displayTierPrice, studentSurfaceCopy } from 'rides-native/riderMoney.js'
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
  const studentOffer = studentSurfaceCopy(student, 'tiers')
  const [selected, setSelected] = useState(RIDE_TIERS[0].id)
  const [promptOpen, setPromptOpen] = useState(false)
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const listMotion = useEnterMotion(14)

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
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={[styles.back, lift(colors, 'rest')]}
          accessibilityRole="button"
          accessibilityLabel="Back"
          accessibilityHint="Returns to confirm pickup"
          hitSlop={8}
        >
          <Text style={styles.backLabel}>←</Text>
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.kicker}>To {dest}</Text>
          <Text style={styles.sub}>Pickup {pickup}</Text>
        </View>
      </View>
      <Pressable
        onPress={() => router.push(user ? '/student' : '/sign-in')}
        style={[styles.promo, !studentOffer.granted && styles.promoGated, lift(colors, 'rest')]}
        accessibilityRole="button"
        accessibilityLabel={studentOffer.detail ? `${studentOffer.title}. ${studentOffer.detail}` : studentOffer.title}
        accessibilityHint={user ? 'Opens student pricing' : 'Sign in to check student pricing'}
        hitSlop={8}
      >
        <Text style={styles.promoText}>{studentOffer.title}</Text>
        {studentOffer.detail ? <Text style={styles.promoDetail}>{studentOffer.detail}</Text> : null}
      </Pressable>
      <Animated.ScrollView style={[{ flex: 1 }, listMotion]} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {RIDE_TIERS.map((tier) => {
          const on = tier.id === selected
          const quoted = displayTierPrice(tier.price, { isStudent: student.verified, tier: tier.id })
          return (
            <Pressable
              key={tier.id}
              onPress={() => setSelected(tier.id)}
              style={({ pressed }) => [
                styles.row,
                lift(colors, 'rest'),
                tier.id === 'tesla' && styles.rowFleet,
                on && styles.rowOn,
                pressStyle(pressed),
              ]}
              accessibilityRole="button"
              accessibilityLabel={`${tier.name}, ${formatUsd(quoted.price)}, ${tier.eta}, ${tier.meta}`}
              accessibilityHint="Selects this fare"
              accessibilityState={{ selected: on }}
            >
              <View style={[styles.iconWell, on && styles.iconWellOn]}>
                <Text style={styles.icon}>{tier.icon}</Text>
              </View>
              <View style={styles.tierCopy}>
                <Text style={styles.name}>{tier.name}</Text>
                {tier.id === 'tesla' ? <Text style={styles.fleetBadge}>Clemson fleet</Text> : null}
                <Text style={styles.meta}>{tier.eta} · {tier.meta}</Text>
                {quoted.label ? <Text style={styles.discount}>{quoted.label}</Text> : null}
              </View>
              <View style={styles.priceCol}>
                <Text style={styles.price}>{formatUsd(quoted.price)}</Text>
                {quoted.discount > 0 ? <Text style={styles.was}>{formatUsd(tier.price)}</Text> : null}
              </View>
            </Pressable>
          )
        })}
      </Animated.ScrollView>
      {selected === 'tesla' ? (
        <View style={styles.stub}>
          <Text style={styles.stubText}>{TESLA_FLEET_NOTICE}</Text>
        </View>
      ) : null}
      <View style={[styles.footer, lift(colors, 'bar'), { paddingBottom: Math.max(insets.bottom, 16) }]}>
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
    header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingHorizontal: 20, paddingBottom: 12 },
    headerCopy: { flex: 1 },
    back: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card, alignItems: 'center' as const, justifyContent: 'center' as const },
    backLabel: { fontSize: 18, color: colors.title, fontWeight: '700' as const },
    kicker: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.4, color: colors.title },
    sub: { color: colors.inkSecondary, fontSize: 13, lineHeight: 18, marginTop: 2 },
    promo: {
      marginHorizontal: 20,
      marginBottom: 8,
      alignSelf: 'flex-start' as const,
      backgroundColor: colors.purpleSoft,
      borderRadius: 999,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    promoText: { color: colors.link, fontWeight: '700' as const, fontSize: 13 },
    promoGated: { alignSelf: 'stretch' as const, borderRadius: 16, paddingVertical: 12 },
    promoDetail: { color: colors.inkSecondary, fontSize: 13, lineHeight: 18, marginTop: 4 },
    list: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20, gap: 10 },
    row: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 12,
      backgroundColor: colors.card,
      borderRadius: 18,
      padding: 14,
      borderWidth: 1.5,
      borderColor: 'transparent',
    },
    rowOn: { borderColor: colors.orange, backgroundColor: colors.orangeSoft },
    rowFleet: { borderColor: colors.purple, backgroundColor: colors.purpleSoft },
    iconWell: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: colors.purpleSoft,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    iconWellOn: { backgroundColor: colors.card },
    tierCopy: { flex: 1 },
    priceCol: { alignItems: 'flex-end' as const },
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
    footer: { paddingHorizontal: 20, paddingTop: 12, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border },
    stub: { marginHorizontal: 20, marginBottom: 10, backgroundColor: colors.orangeSoft, borderRadius: 16, padding: 14 },
    stubText: { color: colors.link, fontSize: 13, lineHeight: 18, fontWeight: '600' as const },
  }
}
