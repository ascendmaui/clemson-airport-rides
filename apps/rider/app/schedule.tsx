import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { MainTabs } from '@/components/MainTabs'
import { SignInToBookSheet } from '@/components/SignInToBookSheet'
import { setAuthNext } from '@/lib/authNext'
import { useAuth } from '@/lib/auth'
import { openStripeCheckout } from '@/lib/openCheckout'
import { supabase } from '@/lib/supabase'
import {
  AIRPORT_CHOICES,
  loadStudentProfile,
  loadTripDeposit,
  quoteAirportFare,
  quoteInputKey,
  startAirportDeposit,
  studentStatus,
} from 'rides-native/riderMoney.js'
import { formatCents } from 'rides-native/tripTags.js'
import { INK, INK_SECONDARY, ORANGE, PURPLE, SURFACE } from 'rides-native/places.js'

type Quote = {
  fareCents: number
  cashCents: number
  depositCents: number
  studentDiscountCents: number
  surgeMultiplier: number
  surgeLabel: string | null
  routeSource: string | null
}

type Phase =
  | { status: 'loading'; key: string }
  | { status: 'ready'; key: string; quote: Quote }
  | { status: 'error'; key: string; message: string }

export default function ScheduleScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const [airport, setAirport] = useState<'GSP' | 'CLT'>('GSP')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [focusTick, setFocusTick] = useState(0)
  const [phase, setPhase] = useState<Phase>({ status: 'loading', key: 'GSP||' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const [promptOpen, setPromptOpen] = useState(false)
  const [studentOn, setStudentOn] = useState(false)
  const generation = useRef(0)

  useFocusEffect(useCallback(() => {
    setFocusTick((n) => n + 1)
  }, []))

  const key = `${quoteInputKey({ airport, date, time })}|${studentOn ? 'student' : 'standard'}`

  useEffect(() => {
    if (!user || !supabase) {
      setStudentOn(false)
      return undefined
    }
    let alive = true
    loadStudentProfile(supabase, user.id).then((row) => {
      if (!alive) return
      setStudentOn(studentStatus({
        email: row.email || user.email,
        studentVerifiedAt: row.studentVerifiedAt,
      }).verified)
    })
    return () => {
      alive = false
    }
  }, [user, focusTick])

  useEffect(() => {
    const handle = setTimeout(() => {
      const ticket = ++generation.current
      setPhase({ status: 'loading', key })
      quoteAirportFare(supabase, { airport, date, time, isStudent: studentOn })
        .then((quote) => {
          if (generation.current !== ticket) return
          setPhase({ status: 'ready', key, quote: quote as Quote })
        })
        .catch((err: unknown) => {
          if (generation.current !== ticket) return
          const message = err instanceof Error ? err.message : 'Could not quote this fare'
          setPhase({ status: 'error', key, message })
        })
    }, 350)
    return () => clearTimeout(handle)
  }, [airport, date, time, key, focusTick, studentOn, user?.id])

  const quote = phase.status === 'ready' && phase.key === key ? phase.quote : null
  const quoting = phase.status === 'loading' || phase.key !== key

  async function pay() {
    if (!user) {
      setAuthNext('/schedule')
      setPromptOpen(true)
      return
    }
    if (!quote || quoting) return
    setBusy(true)
    setError(null)
    setBanner(null)
    try {
      const session = await startAirportDeposit(supabase, {
        airport,
        date,
        time,
        fareCents: quote.fareCents,
        depositCents: quote.depositCents,
        studentDiscountCents: quote.studentDiscountCents,
        riderId: user.id,
        riderName: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Rider',
      })
      const depositCents = Number(session.depositCents) || 0
      const tripId = typeof session.tripId === 'string' ? session.tripId : ''
      if (session.paidWithCredits) {
        setBanner(`Ride covered by credits. No card deposit.${tripId ? ` Trip ${tripId}.` : ''}`)
        return
      }
      const url = typeof session.url === 'string' ? session.url : ''
      if (!url) {
        setError('Checkout did not return a payment URL. No charge was made.')
        return
      }
      setBanner(`Opening Stripe for the ${formatCents(depositCents)} deposit (25% of the recomputed fare).`)
      await openStripeCheckout(url)
      if (!tripId || !supabase) {
        setBanner('Checkout closed. Deposit received only after Stripe records the payment.')
        return
      }
      const settled = await loadTripDeposit(supabase, tripId)
      if (settled.settled) {
        setBanner(`Deposit received · ${formatCents(depositCents)}. We’ll match a driver for this pickup.`)
      } else if (settled.error) {
        setBanner(`Checkout closed. Could not confirm the deposit yet (${settled.error}). Nothing is marked paid.`)
      } else {
        setBanner('Checkout closed. Nothing was charged unless Stripe already confirmed it.')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Checkout failed. No charge was made.'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.kicker}>AIRPORT</Text>
        <Text style={styles.title}>Schedule a ride</Text>
        <Text style={styles.copy}>
          Hold GSP or CLT with a 25% deposit. The amount updates when the airport, time, surge, or student discount changes.
        </Text>

        <View style={styles.choices}>
          {AIRPORT_CHOICES.map((choice) => {
            const on = choice.code === airport
            return (
              <Pressable
                key={choice.code}
                onPress={() => setAirport(choice.code === 'CLT' ? 'CLT' : 'GSP')}
                style={[styles.choice, on && styles.choiceOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={styles.choiceCode}>{choice.code}</Text>
                <Text style={styles.choiceName}>{choice.name}</Text>
              </Pressable>
            )
          })}
        </View>

        <Text style={styles.label}>Date</Text>
        <TextInput
          value={date}
          onChangeText={setDate}
          placeholder="YYYY-MM-DD · empty requests a driver now"
          placeholderTextColor="#8B939E"
          autoCapitalize="none"
          style={styles.input}
        />
        <Text style={styles.label}>Pickup time</Text>
        <TextInput
          value={time}
          onChangeText={setTime}
          placeholder="HH:MM"
          placeholderTextColor="#8B939E"
          autoCapitalize="none"
          style={styles.input}
        />

        <View style={styles.panel}>
          <Row label="Fare" value={quote ? formatCents(quote.fareCents) : quoting ? 'Updating…' : '—'} />
          {quote && quote.studentDiscountCents > 0 ? (
            <Row label="Student discount" value={`−${formatCents(quote.studentDiscountCents)}`} />
          ) : null}
          {quote && quote.surgeMultiplier > 1 ? (
            <Row label={quote.surgeLabel || 'Surge'} value={`${quote.surgeMultiplier}×`} />
          ) : null}
          <Row
            label="25% deposit"
            value={quote ? formatCents(quote.depositCents) : quoting ? 'Updating…' : '—'}
            strong
          />
          <Text style={styles.fine}>
            {quote
              ? `${airport} · ${formatCents(quote.fareCents)} fare → ${formatCents(quote.depositCents)} deposit`
              : 'Pay stays off until this quote matches the airport and time on screen.'}
            {quote?.routeSource === 'fallback' ? ' · fare card estimate' : quote?.routeSource ? ` · ${quote.routeSource}` : ''}
          </Text>
        </View>

        {phase.status === 'error' && phase.key === key ? (
          <Text style={styles.error}>{phase.message}</Text>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {banner ? <Text style={styles.banner}>{banner}</Text> : null}

        <PrimaryButton
          label={busy ? 'Starting checkout…' : quote ? `Pay ${formatCents(quote.depositCents)} deposit` : 'Waiting for fare'}
          onPress={pay}
          disabled={busy || !quote || quoting}
        />
        {!user ? (
          <Text style={styles.copy}>Browse the quote. Sign in when you pay the deposit.</Text>
        ) : null}
        <Pressable onPress={() => router.push('/student')} accessibilityRole="button">
          <Text style={styles.link}>Clemson students save 10% on Standard</Text>
        </Pressable>
      </ScrollView>
      <MainTabs active="schedule" />
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

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.rowStrong]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SURFACE },
  body: { padding: 20, paddingBottom: 28, gap: 8 },
  kicker: { color: ORANGE, fontWeight: '800', letterSpacing: 1.2, fontSize: 12 },
  title: { fontSize: 28, fontWeight: '800', color: PURPLE, letterSpacing: -0.4 },
  copy: { fontSize: 15, lineHeight: 22, color: INK_SECONDARY, marginBottom: 8 },
  choices: { flexDirection: 'row', gap: 10, marginVertical: 8 },
  choice: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(82,45,128,0.12)',
  },
  choiceOn: { borderColor: 'rgba(245,102,0,0.55)', backgroundColor: 'rgba(245,102,0,0.08)' },
  choiceCode: { fontSize: 18, fontWeight: '800', color: INK },
  choiceName: { marginTop: 4, color: INK_SECONDARY, fontSize: 12 },
  label: { marginTop: 8, fontSize: 13, fontWeight: '700', color: INK_SECONDARY },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(82,45,128,0.16)',
    borderRadius: 12,
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: INK,
  },
  panel: {
    marginTop: 12,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(82,45,128,0.08)',
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { color: INK_SECONDARY, fontSize: 14 },
  rowValue: { color: INK, fontWeight: '700', fontSize: 16 },
  rowStrong: { color: ORANGE, fontSize: 18 },
  fine: { color: '#8B939E', fontSize: 12, lineHeight: 18 },
  error: { color: '#B42318', fontSize: 13, lineHeight: 18, marginVertical: 6 },
  banner: {
    backgroundColor: 'rgba(82,45,128,0.08)',
    color: PURPLE,
    borderRadius: 12,
    padding: 12,
    fontSize: 13,
    lineHeight: 18,
    overflow: 'hidden',
  },
  link: { color: PURPLE, fontWeight: '700', marginTop: 14, marginBottom: 8 },
})
