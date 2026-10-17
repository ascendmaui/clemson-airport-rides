import { GlassButton, GlassCard, GlassSheet } from 'rides-native/glass'
import { Glyph } from 'rides-native/icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Animated, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { RetryAction } from '@/components/RetryAction'
import { pressStyle, useEnterMotion } from '@/components/enter'
import { SignInToBookSheet } from '@/components/SignInToBookSheet'
import { setAuthNext } from '@/lib/authNext'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { loadTigerPass, TIGER_PASS_NAME, type TigerPassStatus } from 'rides-native/tigerPassClient'
import { oneParam } from '@/lib/oneParam'
import { RideTypeInfoButton } from 'rides-native/RideTypeSheet'
import { bookableRideTiers, formatUsd } from 'rides-native/places.js'
import { standardCardTiming } from '../../../shared/rideOptions.js'
import { rideTypeIconName } from 'rides-native/rideTypeIcons.js'
import { displayTierPrice, fetchRideQuote, studentSurfaceCopy, withTigerPassQuote, type AirportQuote } from 'rides-native/riderMoney.js'
import { useStudentStatus } from '@/lib/useStudentStatus'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'
import { toastCaught } from '@/lib/caught'
import { useReconnectRetry } from '@/lib/useReconnectRetry'

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
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [quoteAttempt, setQuoteAttempt] = useState(0)
  const [selected, setSelected] = useState(tiers.some((tier) => tier.id === presetTier) ? presetTier : tiers[0].id)
  const [seats, setSeats] = useState(presetSeats)
  const [promptOpen, setPromptOpen] = useState(false)
  const { colors, scheme } = useTheme()
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
    }).catch((err: unknown) => {
      toastCaught('tiers-pass', err, 'Could not load Tiger Pass')
    })
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
      setQuoteError(null)
      const preferred = (next.preferredCarTypes || []).find((id) => tiers.some((tier) => tier.id === id))
      if (preferred && !tiers.some((tier) => tier.id === presetTier)) setSelected(preferred)
    }).catch((err: unknown) => {
      if (alive) setQuoteError('Could not load this fare')
      toastCaught('tiers-quote', err, 'Could not load this fare')
    })
    return () => {
      alive = false
    }
  }, [user, pickup, pickupLat, pickupLng, dest, destLat, destLng, presetTier, quoteAttempt])

  useReconnectRetry('booking-tiers', () => setQuoteAttempt((value) => value + 1), quoteError != null)

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

  const carpoolCatalog = tiers.find((tier) => tier.id === 'carpool') || null
  const carpoolServer = (quote?.tiers || []).find((row) => row.id === 'carpool') || null
  const carpoolQuoted = carpoolCatalog
    ? tierQuote(carpoolCatalog, {
      isStudent: student.verified,
      serverTier: carpoolServer,
      pass,
      passName: quote?.tigerPassName || pass?.name || TIGER_PASS_NAME,
    })
    : null
  const carpoolCharge = carpoolQuoted ? carpoolQuoted.price * seats : null

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <GlassButton
          app="rider"
          scheme={scheme}
          variant="fab"
          onPress={() => router.back()}
          style={styles.back}
          accessibilityLabel="Back"
          accessibilityHint="Returns to confirm pickup"
          hitSlop={8}
        >
          <Glyph name="back" size={20} color={colors.title} accessibilityLabel="Back" />
        </GlassButton>
        <View style={styles.headerCopy}>
          <Text style={styles.kicker}>To {dest}</Text>
          <Text style={styles.sub}>Pickup {pickup}</Text>
        </View>
        <RideTypeInfoButton colors={colors} selectedId={selected} />
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
      {quote?.gameDayPricing ? (
        <View
          accessibilityRole="text"
          accessibilityLabel={`${quote.gameDayPricing.label}. ${quote.gameDayPricing.explainer || ''}`}
          style={styles.passLine}
        >
          <Text style={styles.promoDetail}>
            {quote.gameDayPricing.label}
            {quote.gameDayPricing.multiplier ? ` · ${quote.gameDayPricing.multiplier}×` : ''}
            {quote.gameDayPricing.explainer ? ` — ${quote.gameDayPricing.explainer}` : ''}
          </Text>
        </View>
      ) : null}
      {quote?.peak?.riderLine ? (
        <View accessibilityRole="text" accessibilityLabel={quote.peak.riderLine} style={styles.passLine}>
          <Text style={styles.promoDetail}>{quote.peak.riderLine}</Text>
        </View>
      ) : null}
      {quoteError ? (
        <View accessibilityLiveRegion="polite">
          <Text style={styles.promoDetail}>{quoteError}</Text>
          <RetryAction hint="Loads this fare again" onPress={() => setQuoteAttempt((value) => value + 1)} />
        </View>
      ) : null}
      <Animated.ScrollView style={[{ flex: 1 }, listMotion]} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {tiers.map((tier) => {
          const on = tier.id === selected
          const serverTier = (quote?.tiers || []).find((row) => row.id === tier.id) || null
          const quoted = tierQuote(tier, {
            isStudent: student.verified,
            serverTier,
            pass,
            passName: quote?.tigerPassName || pass?.name || TIGER_PASS_NAME,
          })
          const timing = tier.id === 'standard'
            ? standardCardTiming({
              etaMinutes: serverTier?.etaMinutes ?? quote?.etaMinutes ?? etaMinutesFromLabel(tier.eta),
              tripMinutes: serverTier?.tripMinutes ?? quote?.tripMinutes,
            })
            : ''
          return (
            <Pressable
              key={tier.id}
              onPress={() => setSelected(tier.id)}
              style={({ pressed }) => [
                styles.row,
                tier.id === 'standard' && styles.rowStack,
                tier.id === 'comfort' && styles.rowFleet,
                on && styles.rowOn,
                pressStyle(pressed),
              ]}
              accessibilityRole="button"
              accessibilityLabel={timing ? `${tier.name}, ${formatUsd(tier.id === 'carpool' && on && carpoolCharge != null ? carpoolCharge : quoted.price)}, ${timing}` : `${tier.name}, ${formatUsd(tier.id === 'carpool' && on && carpoolCharge != null ? carpoolCharge : quoted.price)}, ${tier.eta}, ${tier.meta}`}
              accessibilityHint="Selects this fare"
              accessibilityState={{ selected: on }}
            >
              <GlassCard app="rider" scheme={scheme} pointerEvents="none" selected={on} style={styles.cardGlass} />
              <View style={styles.rowMain}>
                <View style={[styles.iconWell, { borderColor: on ? colors.orange : colors.purple }, on && styles.iconWellOn]}>
                  <Glyph name={rideTypeIconName(tier.id)} size={26} color={on ? colors.orange : colors.purple} />
                </View>
                <View style={styles.tierCopy}>
                  <Text style={styles.name}>{tier.name}</Text>
                  <Text style={styles.meta}>{tier.eta} · {tier.meta}</Text>
                  {quoted.label ? <Text style={styles.discount}>{quoted.label}</Text> : null}
                </View>
                <View style={styles.priceCol}>
                  <Text style={styles.price}>{formatUsd(tier.id === 'carpool' && on ? (carpoolCharge ?? quoted.price) : quoted.price)}</Text>
                  {quoted.discount > 0 ? <Text style={styles.was}>{formatUsd(quoted.was)}</Text> : null}
                </View>
              </View>
              {timing ? <Text style={styles.timing}>{timing}</Text> : null}
            </Pressable>
          )
        })}
      </Animated.ScrollView>
      <GlassSheet app="rider" scheme={scheme} style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
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
                  borderColor: seats === count ? colors.orange : colors.border,
                }}
              >
                <Text style={styles.name}>{count === 1 ? '1 seat' : '2 seats'}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {selected === 'carpool' && carpoolCharge != null ? (
          <Text style={{ fontSize: 13, fontWeight: '700', marginBottom: 8, color: colors.ink }}>
            {seats === 1 ? '1 seat' : '2 seats'} · {formatUsd(carpoolCharge)}
          </Text>
        ) : null}
        <PrimaryButton label={selected === 'comfort' ? 'Request Extra Comfort' : selected === 'carpool' ? 'Request Carpool' : 'Choose a driver'} onPress={onConfirm} tone={selected === 'comfort' ? 'purple' : 'orange'} />
      </GlassSheet>
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

function etaMinutesFromLabel(label: string): number | null {
  const match = /(\d+)/.exec(label || '')
  if (!match) return null
  const minutes = Number(match[1])
  return Number.isFinite(minutes) && minutes > 0 ? minutes : null
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
    back: { width: 44, height: 44, borderRadius: 22, padding: 0, alignItems: 'center' as const, justifyContent: 'center' as const },
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
    cardGlass: { position: 'absolute' as const, top: 0, right: 0, bottom: 0, left: 0 },
    row: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 12,
      borderRadius: 18,
      padding: 14,
      overflow: 'hidden' as const,
    },
    rowStack: { flexDirection: 'column' as const, alignItems: 'stretch' as const },
    rowMain: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 },
    timing: { color: colors.inkSecondary, fontSize: 12, fontWeight: '600' as const, marginTop: 8 },
    rowOn: { borderColor: colors.orange, backgroundColor: colors.orangeSoft },
    rowFleet: { borderColor: colors.purple, backgroundColor: colors.purpleSoft },
    iconWell: {
      width: 48,
      height: 48,
      borderRadius: 16,
      backgroundColor: colors.purpleSoft,
      borderWidth: 1.5,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    iconWellOn: { backgroundColor: colors.card },
    tierCopy: { flex: 1 },
    priceCol: { alignItems: 'flex-end' as const },
    name: { fontWeight: '700' as const, fontSize: 16, color: colors.ink },
    meta: { color: colors.inkSecondary, fontSize: 12, marginTop: 2 },
    price: { fontWeight: '800' as const, color: colors.ink, fontSize: 16 },
    was: { color: colors.inkSecondary, fontSize: 12, textDecorationLine: 'line-through' as const },
    discount: { color: colors.orange, fontSize: 12, fontWeight: '700' as const, marginTop: 2 },
    footer: { paddingHorizontal: 20, paddingTop: 12, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border },
  }
}
