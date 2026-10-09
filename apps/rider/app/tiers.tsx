import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Animated, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { pressStyle, useEnterMotion } from '@/components/enter'
import { SignInToBookSheet } from '@/components/SignInToBookSheet'
import { setAuthNext } from '@/lib/authNext'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { loadTigerPass, TIGER_PASS_NAME, type TigerPassStatus } from 'rides-native/tigerPassClient'
import { oneParam } from '@/lib/oneParam'
import { bookableRideTiers, formatUsd } from 'rides-native/places.js'
import { rideTypeIconName } from 'rides-native/rideTypeIcons.js'
import { displayTierPrice, fetchRideQuote, studentSurfaceCopy, withTigerPassQuote, type AirportQuote } from 'rides-native/riderMoney.js'
import { useStudentStatus } from '@/lib/useStudentStatus'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

export default function RideTiers() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{
    dest?: string
    pickup?: string
    note?: string
    pickupLat?: string
    pickupLng?: string
    destLat?: string
    destLng?: string
    tier?: string
    passengers?: string
  }>()
  const dest = oneParam(params.dest, 'GSP Airport')
  const pickup = oneParam(params.pickup, 'Memorial Stadium · Lot 5')
  const note = oneParam(params.note)
  const pickupLat = oneParam(params.pickupLat)
  const pickupLng = oneParam(params.pickupLng)
  const destLat = oneParam(params.destLat)
  const destLng = oneParam(params.destLng)
  const presetTier = oneParam(params.tier)
  const presetSeats = oneParam(params.passengers) === '2' ? 2 : 1
  const { user } = useAuth()
  const student = useStudentStatus()
  const studentOffer = studentSurfaceCopy(student, 'tiers')
  const tiers = bookableRideTiers()
  const [pass, setPass] = useState<TigerPassStatus | null>(null)
  const [quote, setQuote] = useState<AirportQuote | null>(null)
  const [selected, setSelected] = useState(tiers.some((tier) => tier.id === presetTier) ? presetTier : tiers[0].id)
  const [seats, setSeats] = useState(presetSeats)
  const [promptOpen, setPromptOpen] = useState(false)
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const listMotion = useEnterMotion(14)

  useEffect(() => {
    if (!user || !supabase) return undefined
    let alive = true
    loadTigerPass(supabase).then((next) => {
      if (!alive) return
      setPass(next)
      const preferred = (next.preferredCarTypes || []).find((id) => tiers.some((tier) => tier.id === id))
      if (preferred && !tiers.some((tier) => tier.id === presetTier)) setSelected(preferred)
    }).catch(() => {})
    const pickupLatN = Number(pickupLat)
    const pickupLngN = Number(pickupLng)
    const destLatN = Number(destLat)
    const destLngN = Number(destLng)
    fetchRideQuote(supabase, {
      pickupLabel: pickup,
      pickupLat: Number.isFinite(pickupLatN) ? pickupLatN : undefined,
      pickupLng: Number.isFinite(pickupLngN) ? pickupLngN : undefined,
      dest,
      destLat: Number.isFinite(destLatN) ? destLatN : undefined,
      destLng: Number.isFinite(destLngN) ? destLngN : undefined,
    }).then((next) => {
      if (!alive) return
      setQuote(next)
      const preferred = (next.preferredCarTypes || []).find((id) => tiers.some((tier) => tier.id === id))
      if (preferred && !tiers.some((tier) => tier.id === presetTier)) setSelected(preferred)
    }).catch(() => {})
    return () => {
      alive = false
    }
  }, [user, pickup, pickupLat, pickupLng, dest, destLat, destLng, presetTier])

  const next = {
    pathname: '/pick-driver' as const,
    params: {
      dest,
      destLat,
      destLng,
      pickup,
      pickupLat,
      pickupLng,
      note,
      tier: selected,
      ...(selected === 'carpool' ? { passengers: String(seats) } : {}),
    },
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
      {pass?.active || quote?.tigerPassApplied ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${quote?.tigerPassName || pass?.name || TIGER_PASS_NAME} discount`}
          onPress={() => router.push('/tiger-pass')}
          style={styles.passLine}
        >
          <Text style={styles.promoDetail}>
            {(quote?.tigerPassName || pass?.name || TIGER_PASS_NAME)} · {quote?.tigerPassApplied || pass?.active
              ? `${Math.round((quote?.tigerPassDiscountBps || pass?.discountBps || 1000) / 100)}% off this fare`
              : pass?.summary}
          </Text>
        </Pressable>
      ) : null}
      <Animated.ScrollView style={[{ flex: 1 }, listMotion]} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {tiers.map((tier) => {
          const on = tier.id === selected
          const quoted = tierQuote(tier, {
            isStudent: student.verified,
            serverTier: (quote?.tiers || []).find((row) => row.id === tier.id) || null,
            pass,
            passName: quote?.tigerPassName || pass?.name || TIGER_PASS_NAME,
          })
          return (
            <Pressable
              key={tier.id}
              onPress={() => setSelected(tier.id)}
              style={({ pressed }) => [
                styles.row,
                lift(colors, 'rest'),
                tier.id === 'comfort' && styles.rowFleet,
                on && styles.rowOn,
                pressStyle(pressed),
              ]}
              accessibilityRole="button"
              accessibilityLabel={`${tier.name}, ${formatUsd(quoted.price)}, ${tier.eta}, ${tier.meta}`}
              accessibilityHint="Selects this fare"
              accessibilityState={{ selected: on }}
            >
              <View style={[styles.iconWell, on && styles.iconWellOn]}>
                <Ionicons name={rideTypeIconName(tier.id)} size={22} color={on ? colors.orange : colors.purple} />
              </View>
              <View style={styles.tierCopy}>
                <Text style={styles.name}>{tier.name}</Text>
                <Text style={styles.meta}>{tier.eta} · {tier.meta}</Text>
                {quoted.label ? <Text style={styles.discount}>{quoted.label}</Text> : null}
              </View>
              <View style={styles.priceCol}>
                <Text style={styles.price}>{formatUsd(quoted.price)}</Text>
                {quoted.discount > 0 ? <Text style={styles.was}>{formatUsd(quoted.was)}</Text> : null}
              </View>
            </Pressable>
          )
        })}
      </Animated.ScrollView>
      <View style={[styles.footer, lift(colors, 'bar'), { paddingBottom: Math.max(insets.bottom, 16) }]}>
        {selected === 'carpool' ? (
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
            {[1, 2].map((count) => (
              <Pressable
                key={count}
                onPress={() => setSeats(count)}
                accessibilityRole="button"
                accessibilityState={{ selected: seats === count }}
                accessibilityLabel={count === 1 ? '1 seat' : '2 seats'}
                style={{
                  flex: 1,
                  minHeight: 44,
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: seats === count ? 2 : 1,
                  borderColor: seats === count ? '#F56600' : 'rgba(82,45,128,0.25)',
                }}
              >
                <Text style={styles.name}>{count === 1 ? '1 seat' : '2 seats'}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <PrimaryButton label={selected === 'comfort' ? 'Request Extra Comfort' : selected === 'carpool' ? 'Request Carpool' : 'Choose a driver'} onPress={onConfirm} tone={selected === 'comfort' ? 'purple' : 'orange'} />
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

function tierQuote(
  tier: { id: string; price: number },
  {
    isStudent,
    serverTier,
    pass,
    passName,
  }: {
    isStudent: boolean
    serverTier: { fareCents: number; discountCents?: number; tigerPassDiscountCents?: number; tigerPassApplied?: boolean } | null
    pass: TigerPassStatus | null
    passName: string
  },
) {
  if (serverTier && Number.isFinite(serverTier.fareCents)) {
    const studentOff = Math.max(0, Math.round(serverTier.discountCents || 0))
    const passOff = Math.max(0, Math.round(serverTier.tigerPassDiscountCents || 0))
    const before = serverTier.fareCents + studentOff + passOff
    return {
      price: serverTier.fareCents / 100,
      discount: (studentOff + passOff) / 100,
      was: before / 100,
      label: passOff > 0 ? `${passName} · 10% off` : (studentOff > 0 ? 'Clemson student · 10% off Standard' : null),
    }
  }
  const catalog = displayTierPrice(tier.price, { isStudent, tier: tier.id })
  if (!pass?.active) return { ...catalog, was: tier.price }
  const passed = withTigerPassQuote(
    { fareCents: catalog.fareCents, depositCents: 0 },
    { active: true, bps: pass.discountBps, name: passName },
  )
  return {
    price: passed.fareCents / 100,
    discount: catalog.discount + passed.tigerPassDiscountCents / 100,
    was: tier.price,
    label: passed.tigerPassName,
  }
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
    passLine: { marginHorizontal: 20, marginBottom: 8 },
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
    name: { fontWeight: '700' as const, fontSize: 16, color: colors.ink },
    meta: { color: colors.inkSecondary, fontSize: 12, marginTop: 2 },
    price: { fontWeight: '800' as const, color: colors.ink, fontSize: 16 },
    was: { color: colors.inkSecondary, fontSize: 11, textDecorationLine: 'line-through' as const },
    discount: { color: colors.orange, fontSize: 11, fontWeight: '700' as const, marginTop: 2 },
    footer: { paddingHorizontal: 20, paddingTop: 12, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border },
  }
}
