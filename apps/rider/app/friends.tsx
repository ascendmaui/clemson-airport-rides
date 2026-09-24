import { useRouter } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { useFocusEffect } from '@react-navigation/native'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ScrollView, Share, StyleSheet, Switch, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { CarpoolCompare } from '@/components/carpool/CarpoolCompare'
import { NeighborhoodPicker } from '@/components/carpool/NeighborhoodPicker'
import { Card, EmptyState, ErrorText, Field, SkeletonBlock } from '@/components/carpool/ui'
import { MainTabs } from '@/components/MainTabs'
import { setAuthNext } from '@/lib/authNext'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useRegisteredVehicle } from '@/lib/useRegisteredVehicle'
import {
  apiErrorMessage,
  carpoolProgram,
  createCarpoolGroup,
  inviteUrl,
  matchCarpool,
  type FirstRideStatus,
  type MatchResult,
} from 'rides-native/shared/carpoolApi.js'
import {
  clusterOf,
  defaultCarpoolEnds,
  demandWindow,
  formatUsd,
  illustrativePeakAt,
  isGameWeek,
  parseCarpoolToken,
  pitchQuote,
  riderDisplayName,
  type Place,
} from 'rides-native/shared/carpool.js'
import { offerCapacity } from 'rides-native/shared/vehicle.js'
import { INK_SECONDARY, PURPLE, SURFACE } from 'rides-native/places.js'

const START = defaultCarpoolEnds()

export default function CarpoolHubScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const vehicleState = useRegisteredVehicle(user?.id)
  const [pickup, setPickup] = useState<Place>(START.pickup)
  const [dropoff, setDropoff] = useState<Place>(START.dropoff)
  const [tailgate, setTailgate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<MatchResult | null>(null)
  const [code, setCode] = useState('')
  const [firstRide, setFirstRide] = useState<FirstRideStatus | null>(null)
  const [firstRideLoaded, setFirstRideLoaded] = useState(false)
  const now = useMemo(() => new Date(), [])
  const peakAt = useMemo(() => illustrativePeakAt(now), [now])
  const windowNow = demandWindow(now)
  const peakOn = windowNow === 'game_day' || windowNow === 'peak_night'
  const gameWeek = isGameWeek(now)
  const pitch = useMemo(
    () => pitchQuote({ pickup, dropoff, at: peakAt, displayName: 'You' }),
    [pickup, dropoff, peakAt],
  )
  const nowPitch = useMemo(
    () => pitchQuote({ pickup, dropoff, at: now, displayName: 'You' }),
    [pickup, dropoff, now],
  )
  const capacity = offerCapacity(vehicleState.vehicle, { tailgate })
  const cluster = clusterOf(dropoff)

  useFocusEffect(useCallback(() => {
    void vehicleState.reload()
  }, [vehicleState.reload]))

  useEffect(() => {
    if (!user) {
      setFirstRide(null)
      setFirstRideLoaded(true)
      return undefined
    }
    let alive = true
    setFirstRideLoaded(false)
    carpoolProgram(supabase, 'first_ride')
      .then((data) => {
        if (alive) setFirstRide(data)
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setFirstRideLoaded(true)
      })
    return () => {
      alive = false
    }
  }, [user])

  function requireUser(next: '/friends' | '/carpool/offer') {
    if (user) return true
    setAuthNext(next)
    router.push('/sign-in')
    return false
  }

  async function onMatch() {
    if (!requireUser('/friends')) return
    if (!pickup.lat || !dropoff.lat) {
      setError('Pick a start and a neighborhood.')
      return
    }
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const data = await matchCarpool(supabase, {
        pickup,
        dropoff,
        displayName: riderDisplayName(user),
        partyType: tailgate ? 'tailgate' : 'carpool',
      })
      setResult(data)
      if (data.token) router.push(`/carpool/${data.token}`)
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function onShare() {
    if (!requireUser('/friends')) return
    if (!pickup.lat || !dropoff.lat) {
      setError('Pick a start and a neighborhood.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const data = await createCarpoolGroup(supabase, {
        pickup,
        dropoff,
        displayName: riderDisplayName(user),
        partyType: tailgate ? 'tailgate' : 'carpool',
      })
      const url = inviteUrl(data.token, 'carpool')
      try {
        await Share.share({ message: url })
      } catch {
        /* the lobby still has the link */
      }
      router.push(`/carpool/${data.token}`)
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function onJoinCode() {
    const token = parseCarpoolToken(code)
    if (!token) {
      setError('Paste a carpool link or code.')
      return
    }
    setError(null)
    router.push(`/carpool/${token}`)
  }

  const waiting = Boolean(result?.pool?.waiting)
  const neighborhood = result?.pool?.neighborhoodLabel || cluster?.label || 'that neighborhood'

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <LinearGradient
          colors={['#F56600', '#522D80']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={[styles.hero, { paddingTop: insets.top + 28 }]}
        >
          <Text style={styles.brand}>CLEMSON RIDES</Text>
          <Text style={styles.heroTitle}>Split the surge.</Text>
          <Text style={styles.heroBody}>
            One person to Grand Marc or College Ave on a game night is about {formatUsd(pitch.soloCents)}.
            Four Tigers in one car pay about {formatUsd(pitch.fullShareCents)} each.
            The driver earns more than that solo trip.
          </Text>
          <View style={styles.pills}>
            <Text style={styles.pill}>
              {peakOn ? 'Peak pricing is on right now' : 'Peak prices shown for the next Saturday night'}
            </Text>
            {gameWeek ? <Text style={styles.pill}>Game week</Text> : null}
          </View>
        </LinearGradient>

        <View style={styles.body}>
          <CarpoolCompare pickup={pickup} dropoff={dropoff} mode="pitch" at={peakAt} />
          {!peakOn ? (
            <Text style={styles.note}>
              Off-peak right now, this hop is {formatUsd(nowPitch.soloCents)} alone.
              The card above is the game-night price. Confirm uses the time you actually leave.
            </Text>
          ) : null}

          {gameWeek && !firstRideLoaded ? (
            <Card>
              <SkeletonBlock height={16} width="70%" />
              <View style={{ height: 8 }} />
              <SkeletonBlock height={12} />
              <View style={{ height: 6 }} />
              <SkeletonBlock height={12} width="80%" />
            </Card>
          ) : null}
          {gameWeek && firstRideLoaded ? (
            <Card>
              <Text style={styles.cardTitle}>First ride free during game-week peaks</Text>
              <Text style={styles.note}>
                One comp per account, only Thu–Sat nights, class change, and game day. Not a rider promo code.
                {firstRide?.eligible ? ' You are eligible on the next peak ride.' : ''}
                {firstRide?.alreadyUsed ? ' This account already used it.' : ''}
              </Text>
            </Card>
          ) : null}

          <Card>
            <Text style={styles.cardTitle}>Where are you headed?</Text>
            <Text style={styles.note}>
              Dropoffs cluster by Clemson neighborhood
              {cluster ? ` · ${cluster.label}` : ''}. Strangers match inside that cluster, up to 4.
            </Text>
            <NeighborhoodPicker label="Pickup" value={pickup} onChange={setPickup} />
            <NeighborhoodPicker label="Dropoff" value={dropoff} onChange={setDropoff} />
            <View style={styles.tailgate}>
              <Text style={styles.tailgateLabel}>Tailgate / group ride</Text>
              <Switch
                value={tailgate}
                onValueChange={setTailgate}
                trackColor={{ false: 'rgba(82,45,128,0.2)', true: '#F56600' }}
                thumbColor="#fff"
              />
            </View>
            <PrimaryButton label={busy ? 'Looking…' : 'Find my carpool'} onPress={onMatch} disabled={busy} />
            <View style={{ height: 10 }} />
            <PrimaryButton label="Share a link with my group" onPress={onShare} disabled={busy} tone="outline" />
            <PressOffer onPress={() => router.push('/carpool/offer')} />
            {error ? <ErrorText>{error}</ErrorText> : null}
          </Card>

          {user && !vehicleState.loaded ? (
            <Card>
              <SkeletonBlock height={14} width="55%" />
              <View style={{ height: 8 }} />
              <SkeletonBlock height={12} width="80%" />
            </Card>
          ) : null}
          {user && vehicleState.loaded && capacity ? (
            <Card>
              <Text style={styles.cardTitle}>Your car</Text>
              <Text style={styles.note}>
                {capacity.title || 'Registered vehicle'}
                {capacity.plate ? ` · ${capacity.plate}` : ''} · {capacity.seats} seats.
                An offer from this car caps at {capacity.cap} riders.
              </Text>
            </Card>
          ) : null}
          {user && vehicleState.loaded && !capacity && !vehicleState.error ? (
            <EmptyState
              title="No registered car yet"
              body="You can still match or share a group link. Offering seats uses the car on your account."
            />
          ) : null}
          {user && vehicleState.error ? <ErrorText>{vehicleState.error}</ErrorText> : null}

          {waiting ? (
            <EmptyState
              title="You are in the queue"
              body={`No one else is heading to ${neighborhood} inside the time window yet. Share the group link to fill the car yourself — matching still caps strangers at 4.`}
            />
          ) : null}
          {result?.code === 'queue_unavailable' ? (
            <EmptyState title="Prices are ready. The live queue is not." body={result.message || 'Share a group link to split this hop now.'} />
          ) : null}

          <Card>
            <Text style={styles.cardTitle}>Join a carpool</Text>
            <Field
              label="Link or code"
              value={code}
              onChangeText={setCode}
              placeholder="clemson-airport-rides.vercel.app/carpool/…"
              autoCapitalize="none"
            />
            <PrimaryButton label="Open lobby" onPress={onJoinCode} tone="purple" />
          </Card>
        </View>
      </ScrollView>
      <MainTabs active="friends" />
    </View>
  )
}

function PressOffer({ onPress }: { onPress: () => void }) {
  return (
    <Text onPress={onPress} style={styles.offer} accessibilityRole="button">
      I have the car — offer seats
    </Text>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SURFACE },
  scroll: { flex: 1 },
  hero: { paddingHorizontal: 22, paddingBottom: 22 },
  brand: { color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
  heroTitle: { color: '#fff', fontSize: 32, fontWeight: '800', letterSpacing: -0.8, marginTop: 8 },
  heroBody: { color: '#fff', fontSize: 15, lineHeight: 22, marginTop: 10 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  pill: {
    color: '#fff',
    backgroundColor: 'rgba(255,255,255,0.16)',
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    fontWeight: '700',
  },
  body: { paddingHorizontal: 20, paddingBottom: 12 },
  note: { marginTop: 8, color: INK_SECONDARY, fontSize: 13, lineHeight: 18 },
  cardTitle: { color: PURPLE, fontWeight: '800', fontSize: 16 },
  tailgate: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    marginTop: 4,
  },
  tailgateLabel: { fontWeight: '700', fontSize: 14, color: '#0B1220' },
  offer: {
    marginTop: 12,
    textAlign: 'center',
    fontWeight: '700',
    color: INK_SECONDARY,
    paddingVertical: 8,
  },
})
