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
import { useStudentStatus } from '@/lib/useStudentStatus'
import { useThemedStyles } from '@/lib/useThemedStyles'
import {
  abandonAirportCheckout,
  checkoutCloseOutcome,
  checkoutFailureCopy,
  type CheckoutCloseResult,
  depositSurfaceCopy,
  loadTripDeposit,
  quoteAirportFare,
  quoteInputKey,
  startAirportDeposit,
} from 'rides-native/riderMoney.js'
import { localDateInput, localTimeInput, nextPickupDate, RIDE_PLACES } from 'rides-native/riderShell.js'
import { formatCents, formatPickupAt, TESLA_FLEET_NOTICE } from 'rides-native/tripTags.js'
import { dueScheduleReminders } from '../../../src/lib/scheduledRideModel.js'
import { RequireAuth } from '@/components/RequireAuth'

const CAMPUS_PURPOSES: SchedulePurpose[] = ['early_class', 'planned', 'recurring']
type WeekendSpot = 'airport' | 'campus'
type FleetChoice = 'standard' | 'tesla'
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
      return 'Weekend / party'
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

function airportPlace(code: 'GSP' | 'CLT'): RidePlace {
  return placeByLabel(code === 'GSP' ? 'GSP Airport' : 'CLT Airport')
}

function initialWeekendWhen() {
  return nextPickupDate({ time: '21:00', weekdays: ['fri'] })
}

function spotLabel(spot: WeekendSpot) {
  switch (spot) {
    case 'airport':
      return 'Airport'
    case 'campus':
      return 'Campus'
    default: {
      const exhaustive: never = spot
      return exhaustive
    }
  }
}

function ScheduleScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const studentOn = useStudentStatus().verified
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
  const [purpose, setPurpose] = useState<SchedulePurpose>('early_class')
  const [weekdays, setWeekdays] = useState<string[]>(['fri'])
  const [pickup, setPickup] = useState<RidePlace>(placeByLabel('Memorial Stadium'))
  const [dropoff, setDropoff] = useState<RidePlace>(placeByLabel('Sikes Hall'))
  const [campusDate, setCampusDate] = useState('')
  const [campusTime, setCampusTime] = useState('')
  const seededWeekend = initialWeekendWhen()
  const [weekendSpot, setWeekendSpot] = useState<WeekendSpot>('airport')
  const [weekendAirport, setWeekendAirport] = useState<'GSP' | 'CLT'>('GSP')
  const [weekendDate, setWeekendDate] = useState(seededWeekend ? localDateInput(seededWeekend) : '')
  const [weekendTime, setWeekendTime] = useState(seededWeekend ? localTimeInput(seededWeekend) : '21:00')
  const [weekendPickup, setWeekendPickup] = useState<RidePlace>(placeByLabel('Memorial Stadium'))
  const [weekendDropoff, setWeekendDropoff] = useState<RidePlace>(placeByLabel('Downtown Clemson'))
  const [fleet, setFleet] = useState<FleetChoice>('standard')
  const [mine, setMine] = useState<ScheduledRow[]>([])
  const [loadingList, setLoadingList] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [clock, setClock] = useState(() => new Date())
  const reminders = useMemo(() => dueScheduleReminders(mine, clock), [mine, clock])
  const reminderByTrip = useMemo(() => {
    const byTrip = new Map(reminders.map((item) => [item.tripId, item]))
    return byTrip
  }, [reminders])
  const generation = useRef(0)
  const quote = useMemo(() => quoteRide(pickup, dropoff, studentOn), [pickup, dropoff, studentOn])
  const weekendDestination = weekendSpot === 'airport' ? airportPlace(weekendAirport) : weekendDropoff
  const weekendQuote = useMemo(
    () => quoteRide(weekendPickup, weekendDestination, studentOn && fleet !== 'tesla'),
    [weekendPickup, weekendDestination, studentOn, fleet],
  )
  const weekendWhen = nextPickupDate({ date: weekendDate, time: weekendTime })

  useFocusEffect(useCallback(() => {
    setFocusTick((n) => n + 1)
  }, []))

  const key = `${quoteInputKey({ airport, date, time })}|${studentOn ? 'student' : 'standard'}`

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
      setClock(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load scheduled rides')
    } finally {
      setLoadingList(false)
    }
  }

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    void reload()
  }, [user?.id])

  function choosePurpose(next: SchedulePurpose) {
    void tapHaptic()
    setPurpose(next)
    if (next === 'recurring') setWeekdays((days) => (days.length ? days : ['fri']))
  }

  function chooseWeekendSpot(next: WeekendSpot) {
    void tapHaptic()
    setWeekendSpot(next)
    if (next === 'airport') {
      setWeekendPickup(placeByLabel('Memorial Stadium'))
    }
    if (next === 'campus') {
      setWeekendPickup(placeByLabel('White C'))
      setWeekendDropoff(placeByLabel('Downtown Clemson'))
    }
  }

  function chooseFleet(next: FleetChoice) {
    void tapHaptic()
    setFleet(next)
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
      const depositPaid = Number(session.depositCents) || airportQuote.depositCents
      const farePaid = Number(session.fareCents) || airportQuote.fareCents
      const remaining = Math.max(0, farePaid - depositPaid)
      const tripId = typeof session.tripId === 'string' ? session.tripId : ''
      if (session.paidWithCredits) {
        setBanner(`Ride covered by credits. No card deposit, so there is no remaining card balance.${tripId ? ` Trip ${tripId}.` : ''}`)
        await successHaptic()
        await reload()
        if (tripId && !date) {
          router.replace({
            pathname: '/requested',
            params: { trip: tripId, dest: airport === 'CLT' ? 'Charlotte Douglas (CLT)' : 'Greenville-Spartanburg (GSP)' },
          })
        }
        return
      }
      const url = typeof session.url === 'string' ? session.url : ''
      if (!url) {
        setError(checkoutFailureCopy(session) || 'Checkout did not return a payment URL. No charge was made.')
        return
      }
      setBanner(`Opening Stripe for the ${formatCents(depositPaid)} deposit. Remaining balance ${formatCents(remaining)} is collected when the trip is complete.`)
      await openStripeCheckout(url)
      if (!tripId || !supabase) {
        setBanner('Checkout closed. Deposit received only after Stripe records the payment.')
        return
      }
      const settled = await loadTripDeposit(supabase, tripId)
      const sessionId = typeof session.id === 'string' ? session.id : ''
      let close: CheckoutCloseResult | null = null
      if (!settled.settled) {
        try {
          close = await abandonAirportCheckout(supabase, { tripId, sessionId })
        } catch {
          close = null
        }
      }
      const outcome = settled.settled ? 'paid' : checkoutCloseOutcome(close)
      if (outcome === 'paid') {
        setBanner(`Deposit received · ${formatCents(depositPaid)}. Remaining balance ${formatCents(remaining)} is collected when the trip is complete.`)
        await successHaptic()
        if (!date) {
          router.replace({
            pathname: '/requested',
            params: { trip: tripId, dest: airport === 'CLT' ? 'Charlotte Douglas (CLT)' : 'Greenville-Spartanburg (GSP)', paid: '1' },
          })
          return
        }
      } else if (outcome === 'released') {
        setBanner('Checkout closed. Nothing was charged. That unpaid ride is no longer searching for a driver.')
      } else if (settled.error) {
        setBanner(`Checkout closed. Could not confirm the deposit yet (${settled.error}). Nothing is marked paid.`)
      } else {
        setBanner('Checkout closed. Nothing was charged unless Stripe already confirmed it.')
      }
      await reload()
    } catch (err) {
      setError(checkoutFailureCopy(err))
    } finally {
      setBusy(false)
    }
  }

  async function confirmWeekend() {
    if (!user) {
      setAuthNext('/schedule')
      setPromptOpen(true)
      return
    }
    setError(null)
    setBanner(null)
    if (!weekendWhen) {
      setError('Choose a date and time.')
      return
    }
    if (weekendWhen.getTime() < Date.now() + 30 * 60 * 1000) {
      setError('Schedule at least 30 minutes ahead.')
      return
    }
    if (weekendPickup.label === weekendDestination.label) {
      setError('Pickup and drop-off need to be different places.')
      return
    }
    setBusy(true)
    try {
      await createScheduledTrip({
        user,
        pickup: weekendPickup,
        dropoff: weekendDestination,
        pickupAt: weekendWhen,
        purpose: 'party_weekend',
        weekdays: [],
        tier: fleet,
      })
      const fleetLine = fleet === 'tesla' ? ' Tesla Model 3 stays driver-operated.' : ''
      setBanner(`Weekend / party confirmed for ${formatPickupAt(weekendWhen.toISOString())}. It is under Upcoming, and drivers can accept it from Weekend.${fleetLine}`)
      await successHaptic()
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not schedule ride')
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
        <Text style={styles.kicker}>SCHEDULE</Text>
        <Text style={styles.title}>Schedule a ride</Text>
        <Text style={styles.copy}>
          Weekend and party nights to the airport or around campus. Pick a date and time, confirm, then find it under Upcoming.
        </Text>
        {reminders.map((item) => (
          <View key={item.tripId} style={styles.remindCard} accessibilityRole="text" accessibilityLabel={`${item.label}. ${item.body}`}>
            <Text style={styles.remindKicker}>PICKUP REMINDER</Text>
            <Text style={styles.remindTitle}>{item.label}</Text>
            <Text style={styles.fine}>{item.body}</Text>
          </View>
        ))}

        <Text style={styles.section}>Weekend / party</Text>
        <Text style={styles.copy}>
          Friday night through Sunday. Airport runs and campus hops use the same confirm step. Drivers see these in the Weekend filter.
        </Text>
        <View style={styles.pills}>
          {(['airport', 'campus'] as const).map((spot) => (
            <Pill key={spot} label={spotLabel(spot)} active={weekendSpot === spot} onPress={() => chooseWeekendSpot(spot)} />
          ))}
        </View>
        {weekendSpot === 'airport' ? (
          <View style={styles.choices}>
            {(['GSP', 'CLT'] as const).map((code) => {
              const on = code === weekendAirport
              return (
                <Pressable
                  key={`wk-${code}`}
                  onPress={() => setWeekendAirport(code)}
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
        ) : null}
        <Text style={styles.label}>Date</Text>
        <TextInput
          value={weekendDate}
          onChangeText={setWeekendDate}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.placeholder}
          autoCapitalize="none"
          style={styles.input}
        />
        <Text style={styles.label}>Pickup time</Text>
        <TextInput
          value={weekendTime}
          onChangeText={setWeekendTime}
          placeholder="HH:MM"
          placeholderTextColor={colors.placeholder}
          autoCapitalize="none"
          style={styles.input}
        />
        <Text style={styles.fine}>Friday 9:00 PM is filled in. Change it for another slot, at least 30 minutes ahead.</Text>
        <Text style={styles.label}>Pickup</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
          {RIDE_PLACES.map((place) => (
            <Pill key={`wpu-${place.label}`} label={place.label} active={weekendPickup.label === place.label} onPress={() => setWeekendPickup(place)} />
          ))}
        </ScrollView>
        {weekendSpot === 'campus' ? (
          <>
            <Text style={styles.label}>Drop-off</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
              {RIDE_PLACES.map((place) => (
                <Pill key={`wdo-${place.label}`} label={place.label} active={weekendDropoff.label === place.label} onPress={() => setWeekendDropoff(place)} />
              ))}
            </ScrollView>
          </>
        ) : (
          <Text style={styles.fine}>Drop-off is {weekendDestination.label}.</Text>
        )}
        <Text style={styles.label}>Vehicle</Text>
        <View style={styles.pills}>
          <Pill label="Standard" active={fleet === 'standard'} onPress={() => chooseFleet('standard')} />
          <Pill label="Tesla Model 3" active={fleet === 'tesla'} onPress={() => chooseFleet('tesla')} />
        </View>
        {fleet === 'tesla' ? (
          <View style={styles.fleetNote}>
            <Text style={styles.fleetKicker}>CLEMSON FLEET</Text>
            <Text style={styles.fleetText}>{TESLA_FLEET_NOTICE}</Text>
          </View>
        ) : null}
        <View style={styles.panel}>
          <Text style={styles.cardLine}>Confirm weekend / party</Text>
          <Text style={styles.fine}>
            {weekendWhen ? formatPickupAt(weekendWhen.toISOString()) : 'Choose a date and time.'}
          </Text>
          <Text style={styles.fine}>{weekendPickup.label} → {weekendDestination.label}</Text>
          <Text style={styles.cardLine}>
            {weekendQuote.estimate ? 'Fare estimate' : 'Fare'} · {formatUsd(weekendQuote.fareCents / 100)}
          </Text>
          {weekendQuote.label ? <Text style={styles.student}>{weekendQuote.label}</Text> : null}
          <Text style={styles.fine}>
            {fleet === 'tesla' ? 'Tesla Model 3 · a driver is at the wheel.' : 'Standard vehicle.'}
            {weekendQuote.depositCents > 0
              ? ` ${depositSurfaceCopy(weekendQuote, 'confirm', { studentDiscountCents: weekendQuote.discountCents }) || ''}`
              : ' Final fare can change when a driver accepts.'}
          </Text>
        </View>
        <PrimaryButton
          label={busy ? 'Confirming…' : 'Confirm weekend ride'}
          onPress={confirmWeekend}
          disabled={busy}
          tone="purple"
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {banner ? <Text style={styles.banner}>{banner}</Text> : null}

        <Text style={styles.section}>Airport deposit</Text>
        <Text style={styles.copy}>
          Hold GSP or CLT with a 25% deposit. The amount updates when the airport, time, surge, or student discount changes. Leave the date empty to request a driver now.
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
          <Row
            label="Remaining balance"
            value={airportQuote ? formatCents(Math.max(0, airportQuote.fareCents - airportQuote.depositCents)) : quoting ? 'Updating…' : '—'}
            tone="purple"
          />
          <Text style={styles.balance}>
            {airportQuote
              ? depositSurfaceCopy(airportQuote, 'quote', { studentDiscountCents: airportQuote.studentDiscountCents })
              : 'Pay deposit stays off until this quote matches the airport and time on screen.'}
            {airportQuote?.routeSource === 'fallback' ? ' Fare card estimate until the quote route answers.' : ''}
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
        <Text style={styles.fine}>
          Pay deposit opens Stripe Checkout. If Stripe is not configured on this machine, checkout stops and nothing is charged. Live mode stays off.
        </Text>
        {!user ? (
          <Text style={styles.copy}>Browse the quote. Sign in when you pay the deposit.</Text>
        ) : null}
        <Pressable onPress={() => router.push('/student')} accessibilityRole="button">
          <Text style={styles.link}>Clemson students save 10% on Standard</Text>
        </Pressable>

        <Text style={styles.section}>Class, planned, and weekly rides</Text>
        <Text style={styles.copy}>These rides save a pickup. Weekend and party trips use the confirm step above. Airport deposits stay on the checkout above.</Text>
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
            {quote.depositCents > 0
              ? depositSurfaceCopy(quote, 'confirm', { studentDiscountCents: quote.discountCents })
              : `About ${quote.miles ?? '—'} mi. Final fare can change when a driver accepts.`}
          </Text>
        </View>
        <PrimaryButton label={busy ? 'Scheduling…' : 'Schedule ride'} onPress={onSchedule} disabled={busy} tone="purple" />

        <Text style={styles.section}>Upcoming</Text>
        {loadingList ? <Skeleton height={64} /> : null}
        {!user ? <Text style={styles.copy}>Sign in to see rides saved on this account.</Text> : null}
        {user && !loadingList && mine.filter((row) => row.status !== 'canceled').length === 0 ? (
          <View style={styles.panel}>
            <Text style={styles.cardLine}>No upcoming rides</Text>
            <Text style={styles.copy}>Confirm a weekend airport or campus trip and it will show up here.</Text>
          </View>
        ) : null}
        {mine.filter((row) => row.status !== 'canceled').map((row) => {
          const reminder = reminderByTrip.get(row.id)
          return (
            <View key={row.id} style={styles.panel}>
            {reminder ? <Text style={styles.remindKicker}>{reminder.label}</Text> : null}
            <Text style={styles.cardLine}>{row.pickup_label} → {row.dropoff_label}</Text>
            <Text style={styles.fine}>
              {rowPurpose(row)} · {row.status} · {formatPickupAt(row.pickup_at || row.scheduled_for)}
              {row.metadata?.recurrence?.weekdays?.length ? ` · weekly ${row.metadata.recurrence.weekdays.join(', ')}` : ''}
            </Text>
            {row.tier === 'tesla' ? <Text style={styles.student}>Tesla Model 3 · driver at the wheel</Text> : null}
            {row.deposit_cents ? (
              <Text style={styles.balance}>
                {depositSurfaceCopy(
                  { fareCents: row.fare_cents || 0, depositCents: row.deposit_cents },
                  'upcoming',
                )}
              </Text>
            ) : null}
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
          )
        })}
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

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'purple' }) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, tone === 'purple' && styles.rowPurple]}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.rowStrong, tone === 'purple' && styles.rowPurple]}>{value}</Text>
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
    rowPurple: { color: colors.purple, fontWeight: '700' as const },
    fine: { color: colors.placeholder, fontSize: 12, lineHeight: 18 },
    balance: { color: colors.purple, fontSize: 13, lineHeight: 18, fontWeight: '700' as const },
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
    fleetNote: {
      marginTop: 8,
      backgroundColor: colors.purpleSoft,
      borderRadius: 16,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.purple,
    },
    fleetKicker: { color: colors.orange, fontWeight: '800' as const, letterSpacing: 1, fontSize: 11, marginBottom: 4 },
    fleetText: { color: colors.link, fontSize: 13, lineHeight: 18, fontWeight: '600' as const },
    remindCard: {
      backgroundColor: colors.orangeSoft,
      borderRadius: 16,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.orange,
      gap: 2,
    },
    remindKicker: { color: colors.orange, fontSize: 11, fontWeight: '800' as const, letterSpacing: 1.1 },
    remindTitle: { color: colors.purple, fontSize: 16, fontWeight: '800' as const, marginTop: 4 },
  }
}

function rowPurpose(row: ScheduledRow) {
  const id = row.metadata?.purpose || row.rider_note || ''
  switch (id) {
    case 'early_class':
    case 'airport':
    case 'planned':
    case 'party_weekend':
    case 'recurring':
      return purposeLabel(id)
    default:
      return 'Planned trip'
  }
}


export default function ScheduleScreenRoute() {
  return (
    <RequireAuth>
      <ScheduleScreen />
    </RequireAuth>
  )
}
