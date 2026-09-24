import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Pill, PrimaryButton } from '@/components/Button'
import { MainTabs } from '@/components/MainTabs'
import { SignInToBookSheet } from '@/components/SignInToBookSheet'
import { Skeleton } from '@/components/Skeleton'
import { setAuthNext } from '@/lib/authNext'
import { useAuth } from '@/lib/auth'
import { successHaptic, tapHaptic } from '@/lib/feedback'
import { openStripeCheckout } from '@/lib/openCheckout'
import {
  cancelScheduledTrip,
  createScheduledTrip,
  listScheduledTrips,
  quoteRide,
  type RidePlace,
  type SchedulePurpose,
  type ScheduledRow,
} from '@/lib/scheduleApi'
import { supabase } from '@/lib/supabase'
import { formatUsd } from 'rides-native/places.js'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'
import {
  loadStudentProfile,
  loadTripDeposit,
  quoteAirportFare,
  quoteInputKey,
  startAirportDeposit,
  studentStatus,
} from 'rides-native/riderMoney.js'
import { localDateInput, localTimeInput, nextPickupDate, RIDE_PLACES } from 'rides-native/riderShell.js'
import { formatCents } from 'rides-native/tripTags.js'

const CAMPUS_PURPOSES: SchedulePurpose[] = ['early_class', 'planned', 'party_weekend', 'recurring']
const WEEKDAYS = [
  { id: 'mon', label: 'Mon' },
  { id: 'tue', label: 'Tue' },
  { id: 'wed', label: 'Wed' },
  { id: 'thu', label: 'Thu' },
  { id: 'fri', label: 'Fri' },
  { id: 'sat', label: 'Sat' },
  { id: 'sun', label: 'Sun' },
]

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

function purposeLabel(id: SchedulePurpose) {
  switch (id) {
    case 'early_class':
      return 'Early class'
    case 'airport':
      return 'Airport'
    case 'planned':
      return 'Planned trip'
    case 'party_weekend':
      return 'Party weekend'
    case 'recurring':
      return 'Recurring'
    default: {
      const exhaustive: never = id
      return exhaustive
    }
  }
}

function placeByLabel(label: string): RidePlace {
  const found = RIDE_PLACES.find((place) => place.label === label)
  return found || RIDE_PLACES[0]
}

export default function ScheduleScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
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
  const [purpose, setPurpose] = useState<SchedulePurpose>('early_class')
  const [weekdays, setWeekdays] = useState<string[]>(['fri'])
  const [pickup, setPickup] = useState<RidePlace>(placeByLabel('Memorial Stadium'))
  const [dropoff, setDropoff] = useState<RidePlace>(placeByLabel('Sikes Hall'))
  const [campusDate, setCampusDate] = useState('')
  const [campusTime, setCampusTime] = useState('')
  const [mine, setMine] = useState<ScheduledRow[]>([])
  const [loadingList, setLoadingList] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const generation = useRef(0)
  const quote = useMemo(() => quoteRide(pickup, dropoff, studentOn), [pickup, dropoff, studentOn])

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
        .then((next) => {
          if (generation.current !== ticket) return
          setPhase({ status: 'ready', key, quote: next as Quote })
        })
        .catch((err: unknown) => {
          if (generation.current !== ticket) return
          const message = err instanceof Error ? err.message : 'Could not quote this fare'
          setPhase({ status: 'error', key, message })
        })
    }, 350)
    return () => clearTimeout(handle)
  }, [airport, date, time, key, focusTick, studentOn, user?.id])

  const airportQuote = phase.status === 'ready' && phase.key === key ? phase.quote : null
  const quoting = phase.status === 'loading' || phase.key !== key

  async function reload() {
    if (!user?.id) {
      setMine([])
      return
    }
    setLoadingList(true)
    try {
      setMine(await listScheduledTrips(user.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load scheduled rides')
    } finally {
      setLoadingList(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [user?.id])

  function choosePurpose(next: SchedulePurpose) {
    void tapHaptic()
    setPurpose(next)
    if (next === 'party_weekend') {
      const when = nextPickupDate({ time: '21:00', weekdays: ['fri'] })
      if (when) {
        setCampusDate(localDateInput(when))
        setCampusTime(localTimeInput(when))
      }
      setPickup(placeByLabel('White C'))
      setDropoff(placeByLabel('Downtown Clemson'))
    }
    if (next === 'recurring') setWeekdays((days) => (days.length ? days : ['fri']))
  }

  async function pay() {
    if (!user) {
      setAuthNext('/schedule')
      setPromptOpen(true)
      return
    }
    if (!airportQuote || quoting) return
    setBusy(true)
    setError(null)
    setBanner(null)
    try {
      const session = await startAirportDeposit(supabase, {
        airport,
        date,
        time,
        fareCents: airportQuote.fareCents,
        depositCents: airportQuote.depositCents,
        studentDiscountCents: airportQuote.studentDiscountCents,
        riderId: user.id,
        riderName: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Rider',
      })
      const depositCents = Number(session.depositCents) || 0
      const tripId = typeof session.tripId === 'string' ? session.tripId : ''
      if (session.paidWithCredits) {
        setBanner(`Ride covered by credits. No card deposit.${tripId ? ` Trip ${tripId}.` : ''}`)
        await successHaptic()
        await reload()
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
        await successHaptic()
      } else if (settled.error) {
        setBanner(`Checkout closed. Could not confirm the deposit yet (${settled.error}). Nothing is marked paid.`)
      } else {
        setBanner('Checkout closed. Nothing was charged unless Stripe already confirmed it.')
      }
      await reload()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Checkout failed. No charge was made.'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  async function onSchedule() {
    if (!user) {
      setAuthNext('/schedule')
      setPromptOpen(true)
      return
    }
    setError(null)
    setBanner(null)
    const when = nextPickupDate({
      date: purpose === 'recurring' ? campusDate || undefined : campusDate,
      time: campusTime,
      weekdays: purpose === 'recurring' ? weekdays : undefined,
    })
    if (!when) {
      setError(purpose === 'recurring' ? 'Pick at least one weekday and a time.' : 'Choose a date and time.')
      return
    }
    if (when.getTime() < Date.now() + 30 * 60 * 1000) {
      setError('Schedule at least 30 minutes ahead.')
      return
    }
    if (pickup.label === dropoff.label) {
      setError('Pickup and drop-off need to be different places.')
      return
    }
    setBusy(true)
    try {
      const row = await createScheduledTrip({
        user,
        pickup,
        dropoff,
        pickupAt: when,
        purpose,
        weekdays,
        quote,
      })
      setBanner(`${purposeLabel(purpose)} saved · ${row.id}`)
      await successHaptic()
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not schedule ride')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.orange}
            onRefresh={() => {
              setRefreshing(true)
              setFocusTick((n) => n + 1)
              reload().finally(() => setRefreshing(false))
            }}
          />
        )}
      >
        <Text style={styles.kicker}>AIRPORT</Text>
        <Text style={styles.title}>Schedule a ride</Text>
        <Text style={styles.copy}>
          Hold GSP or CLT with a 25% deposit. The amount updates when the airport, time, surge, or student discount changes.
        </Text>

        <View style={styles.choices}>
          {(['GSP', 'CLT'] as const).map((code) => {
            const on = code === airport
            return (
              <Pressable
                key={code}
                onPress={() => setAirport(code)}
                style={[styles.choice, on && styles.choiceOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <Text style={styles.choiceCode}>{code}</Text>
                <Text style={styles.choiceName}>{code === 'GSP' ? 'Greenville-Spartanburg' : 'Charlotte Douglas'}</Text>
              </Pressable>
            )
          })}
        </View>

        <Text style={styles.label}>Date</Text>
        <TextInput
          value={date}
          onChangeText={setDate}
          placeholder="YYYY-MM-DD · empty requests a driver now"
          placeholderTextColor={colors.placeholder}
          autoCapitalize="none"
          style={styles.input}
        />
        <Text style={styles.label}>Pickup time</Text>
        <TextInput
          value={time}
          onChangeText={setTime}
          placeholder="HH:MM"
          placeholderTextColor={colors.placeholder}
          autoCapitalize="none"
          style={styles.input}
        />

        <View style={styles.panel}>
          <Row label="Fare" value={airportQuote ? formatCents(airportQuote.fareCents) : quoting ? 'Updating…' : '—'} />
          {airportQuote && airportQuote.studentDiscountCents > 0 ? (
            <Row label="Student discount" value={`−${formatCents(airportQuote.studentDiscountCents)}`} />
          ) : null}
          {airportQuote && airportQuote.surgeMultiplier > 1 ? (
            <Row label={airportQuote.surgeLabel || 'Surge'} value={`${airportQuote.surgeMultiplier}×`} />
          ) : null}
          <Row
            label="25% deposit"
            value={airportQuote ? formatCents(airportQuote.depositCents) : quoting ? 'Updating…' : '—'}
            strong
          />
          <Text style={styles.fine}>
            {airportQuote
              ? `${airport} · ${formatCents(airportQuote.fareCents)} fare → ${formatCents(airportQuote.depositCents)} deposit`
              : 'Pay stays off until this quote matches the airport and time on screen.'}
            {airportQuote?.routeSource === 'fallback' ? ' · fare card estimate' : airportQuote?.routeSource ? ` · ${airportQuote.routeSource}` : ''}
          </Text>
        </View>

        {phase.status === 'error' && phase.key === key ? (
          <Text style={styles.error}>{phase.message}</Text>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {banner ? <Text style={styles.banner}>{banner}</Text> : null}

        <PrimaryButton
          label={busy ? 'Starting checkout…' : airportQuote ? `Pay ${formatCents(airportQuote.depositCents)} deposit` : 'Waiting for fare'}
          onPress={pay}
          disabled={busy || !airportQuote || quoting}
        />
        {!user ? (
          <Text style={styles.copy}>Browse the quote. Sign in when you pay the deposit.</Text>
        ) : null}
        <Pressable onPress={() => router.push('/student')} accessibilityRole="button">
          <Text style={styles.link}>Clemson students save 10% on Standard</Text>
        </Pressable>

        <Text style={styles.section}>Campus, recurring, and party weekend</Text>
        <Text style={styles.copy}>These rides save a pickup. Airport deposits stay on the checkout above.</Text>
        <View style={styles.pills}>
          {CAMPUS_PURPOSES.map((id) => (
            <Pill key={id} label={purposeLabel(id)} active={purpose === id} onPress={() => choosePurpose(id)} />
          ))}
        </View>
        {purpose === 'recurring' ? (
          <View style={styles.pills}>
            {WEEKDAYS.map((day) => {
              const on = weekdays.includes(day.id)
              return (
                <Pill
                  key={day.id}
                  label={day.label}
                  active={on}
                  onPress={() => setWeekdays((prev) => (on ? prev.filter((item) => item !== day.id) : [...prev, day.id]))}
                />
              )
            })}
          </View>
        ) : null}
        <Text style={styles.label}>{purpose === 'recurring' ? 'First date (optional)' : 'Date'}</Text>
        <TextInput value={campusDate} onChangeText={setCampusDate} placeholder="YYYY-MM-DD" placeholderTextColor={colors.placeholder} style={styles.input} autoCapitalize="none" />
        <Text style={styles.label}>Pickup time</Text>
        <TextInput value={campusTime} onChangeText={setCampusTime} placeholder="HH:MM" placeholderTextColor={colors.placeholder} style={styles.input} autoCapitalize="none" />
        <Text style={styles.label}>Pickup</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
          {RIDE_PLACES.map((place) => (
            <Pill key={`pu-${place.label}`} label={place.label} active={pickup.label === place.label} onPress={() => setPickup(place)} />
          ))}
        </ScrollView>
        <Text style={styles.label}>Drop-off</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
          {RIDE_PLACES.map((place) => (
            <Pill key={`do-${place.label}`} label={place.label} active={dropoff.label === place.label} onPress={() => setDropoff(place)} />
          ))}
        </ScrollView>
        <View style={styles.panel}>
          <Text style={styles.cardLine}>{quote.estimate ? 'Fare estimate' : 'Fare'} · {formatUsd(quote.fareCents / 100)}</Text>
          {quote.label ? <Text style={styles.student}>{quote.label}</Text> : null}
          <Text style={styles.fine}>
            {quote.airport
              ? `${quote.airport} quote. The 25% deposit is collected with Pay deposit above.`
              : `About ${quote.miles ?? '—'} mi. Final fare can change when a driver accepts.`}
          </Text>
        </View>
        <PrimaryButton label={busy ? 'Scheduling…' : 'Schedule ride'} onPress={onSchedule} disabled={busy} tone="purple" />

        <Text style={styles.section}>Upcoming</Text>
        {loadingList ? <Skeleton height={64} /> : null}
        {!user ? <Text style={styles.copy}>Sign in to see rides saved on this account.</Text> : null}
        {user && !loadingList && mine.length === 0 ? <Text style={styles.copy}>No scheduled rides yet.</Text> : null}
        {mine.filter((row) => row.status !== 'canceled').map((row) => (
          <View key={row.id} style={styles.panel}>
            <Text style={styles.cardLine}>{row.pickup_label} → {row.dropoff_label}</Text>
            <Text style={styles.fine}>
              {row.rider_note || 'planned'} · {row.status} · {row.pickup_at ? new Date(row.pickup_at).toLocaleString() : 'Time TBD'}
              {row.metadata?.recurrence?.weekdays?.length ? ` · weekly ${row.metadata.recurrence.weekdays.join(', ')}` : ''}
            </Text>
            {row.status === 'scheduled' || row.status === 'accepted' ? (
              <Pressable
                onPress={() => {
                  cancelScheduledTrip(row.id).then(reload).catch((err) => {
                    setError(err instanceof Error ? err.message : 'Could not cancel')
                  })
                }}
              >
                <Text style={styles.cancel}>Cancel</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
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
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.rowStrong]}>{value}</Text>
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 20, paddingBottom: 28, gap: 8 },
    kicker: { color: colors.orange, fontWeight: '800' as const, letterSpacing: 1.2, fontSize: 12 },
    title: { fontSize: 28, fontWeight: '800' as const, color: colors.title, letterSpacing: -0.4 },
    section: { marginTop: 18, fontSize: 20, fontWeight: '800' as const, color: colors.title },
    copy: { fontSize: 15, lineHeight: 22, color: colors.inkSecondary, marginBottom: 8 },
    choices: { flexDirection: 'row' as const, gap: 10, marginVertical: 8 },
    choice: {
      flex: 1,
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
    },
    choiceOn: { borderColor: colors.orange, backgroundColor: colors.orangeSoft },
    choiceCode: { fontSize: 18, fontWeight: '800' as const, color: colors.ink },
    choiceName: { marginTop: 4, color: colors.inkSecondary, fontSize: 12 },
    label: { marginTop: 8, fontSize: 13, fontWeight: '700' as const, color: colors.inkSecondary },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      backgroundColor: colors.input,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 16,
      color: colors.ink,
    },
    panel: {
      marginTop: 12,
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 16,
      gap: 8,
      borderWidth: 1,
      borderColor: colors.border,
    },
    row: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const },
    rowLabel: { color: colors.inkSecondary, fontSize: 14 },
    rowValue: { color: colors.ink, fontWeight: '700' as const, fontSize: 16 },
    rowStrong: { color: colors.orange, fontSize: 18 },
    fine: { color: colors.placeholder, fontSize: 12, lineHeight: 18 },
    error: { color: colors.danger, fontSize: 13, lineHeight: 18, marginVertical: 6 },
    banner: {
      backgroundColor: colors.purpleSoft,
      color: colors.link,
      borderRadius: 12,
      padding: 12,
      fontSize: 13,
      lineHeight: 18,
      overflow: 'hidden' as const,
    },
    link: { color: colors.link, fontWeight: '700' as const, marginTop: 14, marginBottom: 8 },
    pills: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
    cardLine: { fontWeight: '800' as const, color: colors.ink },
    student: { color: colors.orange, fontWeight: '700' as const, fontSize: 12 },
    cancel: { color: colors.danger, fontWeight: '700' as const, marginTop: 6 },
  }
}
