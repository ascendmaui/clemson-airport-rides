import { useFocusEffect, useRouter } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ScrollView, Share, Switch, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Pill, PrimaryButton } from '@/components/Button'
import { SignInToBookSheet } from '@/components/SignInToBookSheet'
import { CarpoolCompare } from '@/components/carpool/CarpoolCompare'
import { NeighborhoodPicker } from '@/components/carpool/NeighborhoodPicker'
import { Card, EmptyState, ErrorText, Field, SkeletonBlock } from '@/components/carpool/ui'
import { MainTabs } from '@/components/MainTabs'
import { loadAmbassadorCode } from '@/lib/ambassadorCode'
import { setAuthNext } from '@/lib/authNext'
import { useAuth } from '@/lib/auth'
import { successHaptic, tapHaptic } from '@/lib/feedback'
import {
  addFriendByEmail,
  listFriendActivity,
  loadSavedFriends,
  startRideTogether,
  type FriendActivity,
  type SavedFriend,
} from '@/lib/friendsApi'
import { supabase } from '@/lib/supabase'
import { useRegisteredVehicle } from '@/lib/useRegisteredVehicle'
import { ambassadorSavedCopy } from 'rides-native/shared/ambassadorAttribution.js'
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
  firstRideOfferCopy,
  firstRideWindowOpen,
  formatUsd,
  illustrativePeakAt,
  isGameWeek,
  lookupCatalogPlace,
  parseCarpoolToken,
  pitchQuote,
  placeFromStop,
  riderDisplayName,
  type Place,
} from 'rides-native/shared/carpool.js'
import { offerCapacity } from 'rides-native/shared/vehicle.js'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'
const START = defaultCarpoolEnds()
const FRIEND_START = placeFromStop(lookupCatalogPlace('White C')) || START.pickup
const FRIEND_END = placeFromStop(lookupCatalogPlace('College Avenue')) || START.dropoff

export default function CarpoolHubScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const vehicleState = useRegisteredVehicle(user?.id)
  const [pickup, setPickup] = useState<Place>(START.pickup)
  const [dropoff, setDropoff] = useState<Place>(START.dropoff)
  const [tailgate, setTailgate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<MatchResult | null>(null)
  const [code, setCode] = useState('')
  const [firstRide, setFirstRide] = useState<FirstRideStatus | null>(null)
  const [ambassadorCode, setAmbassadorCode] = useState('')
  const [firstRideLoaded, setFirstRideLoaded] = useState(false)
  const now = useMemo(() => new Date(), [])
  const peakAt = useMemo(() => illustrativePeakAt(now), [now])
  const windowNow = demandWindow(now)
  const peakOn = windowNow === 'game_day' || windowNow === 'peak_night'
  const gameWeek = isGameWeek(now)
  const firstRideOffer = !user
    ? firstRideOfferCopy({ windowOpen: firstRideWindowOpen(now), signedIn: false })
    : firstRideLoaded
      ? firstRideOfferCopy({
        windowOpen: Boolean(firstRide?.windowOpen),
        signedIn: true,
        alreadyUsed: Boolean(firstRide?.alreadyUsed),
        completedTrips: firstRide?.completedTrips || 0,
        schemaMissing: Boolean(firstRide?.schemaMissing),
      })
      : null
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
  const [friendEmail, setFriendEmail] = useState('')
  const [friends, setFriends] = useState<SavedFriend[]>([])
  const [activity, setActivity] = useState<FriendActivity[]>([])
  const [friendPickup, setFriendPickup] = useState<Place>(FRIEND_START)
  const [friendDropoff, setFriendDropoff] = useState<Place>(FRIEND_END)
  const [splitMode, setSplitMode] = useState<'even' | 'by_distance'>('even')
  const [friendBusy, setFriendBusy] = useState(false)
  const [friendError, setFriendError] = useState<string | null>(null)
  const [friendNote, setFriendNote] = useState<string | null>(null)
  const [promptOpen, setPromptOpen] = useState(false)
  useFocusEffect(useCallback(() => {
    void vehicleState.reload()
  }, [vehicleState.reload]))

  useEffect(() => {
    let alive = true
    loadAmbassadorCode(user?.id)
      .then((code) => {
        if (alive) setAmbassadorCode(code)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [user?.id])

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

  useEffect(() => {
    let alive = true
    loadSavedFriends()
      .then((rows) => {
        if (alive) setFriends(rows)
      })
      .catch((err: unknown) => {
        if (alive) setFriendError(err instanceof Error ? err.message : 'Could not load friends')
      })
    if (!user?.id) {
      setActivity([])
      return () => {
        alive = false
      }
    }
    listFriendActivity(user.id)
      .then((rows) => {
        if (alive) setActivity(rows)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [user?.id])

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
        ambassadorCode: (await loadAmbassadorCode(user.id)) || undefined,
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
        ambassadorCode: (await loadAmbassadorCode(user.id)) || undefined,
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

  async function onAddFriend() {
    if (!user) {
      setAuthNext('/friends')
      setPromptOpen(true)
      return
    }
    setFriendBusy(true)
    setFriendError(null)
    setFriendNote(null)
    try {
      setFriends(await addFriendByEmail(friendEmail))
      setFriendEmail('')
      setFriendNote('Friend added.')
      await successHaptic()
    } catch (err) {
      setFriendError(err instanceof Error ? err.message : 'Could not add that friend')
    } finally {
      setFriendBusy(false)
    }
  }

  async function onRideTogether() {
    if (!user) {
      setAuthNext('/friends')
      setPromptOpen(true)
      return
    }
    if (friendPickup.label === friendDropoff.label) {
      setFriendError('Pickup and drop-off need to be different places.')
      return
    }
    setFriendBusy(true)
    setFriendError(null)
    setFriendNote(null)
    try {
      const created = await startRideTogether({
        displayName: riderDisplayName(user),
        pickup: friendPickup,
        dropoff: friendDropoff,
        splitMode,
        partyType: tailgate ? 'tailgate' : 'carpool',
      })
      const token = typeof created.token === 'string' ? created.token : ''
      await successHaptic()
      if (token) {
        router.push(`/carpool/${token}`)
        return
      }
      setFriendNote('Ride together request sent.')
      setActivity(await listFriendActivity(user.id))
    } catch (err) {
      setFriendError(err instanceof Error ? err.message : 'Could not start the group ride')
    } finally {
      setFriendBusy(false)
    }
  }

  const waiting = Boolean(result?.pool?.waiting)
  const neighborhood = result?.pool?.neighborhoodLabel || cluster?.label || 'that neighborhood'

  return (
    <View style={styles.screen}>
      <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <LinearGradient
          colors={[colors.orange, colors.purple]}
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

          {user && !firstRideLoaded && firstRideWindowOpen(now) ? (
            <Card>
              <SkeletonBlock height={16} width="70%" />
              <View style={{ height: 8 }} />
              <SkeletonBlock height={12} />
              <View style={{ height: 6 }} />
              <SkeletonBlock height={12} width="80%" />
            </Card>
          ) : null}
          {firstRideOffer ? (
            <Card>
              <Text style={styles.cardTitle}>{firstRideOffer.title}</Text>
              <Text style={styles.note}>{firstRideOffer.body}</Text>
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
                trackColor={{ false: colors.track, true: colors.orange }}
                thumbColor={colors.onAccent}
              />
            </View>
            {ambassadorCode ? (
              <Text style={styles.note}>
                {ambassadorSavedCopy().title}. {ambassadorSavedCopy().body}
              </Text>
            ) : null}
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

          <Card>
            <Text style={styles.cardTitle}>Add a rider</Text>
            <Text style={styles.note}>Saved on this phone, then used when you start a ride together.</Text>
            <TextInput
              value={friendEmail}
              onChangeText={setFriendEmail}
              placeholder="friend@clemson.edu"
              placeholderTextColor={colors.placeholder}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              style={styles.input}
            />
            <PrimaryButton label={friendBusy ? 'Working…' : 'Add friend'} onPress={onAddFriend} disabled={friendBusy || !friendEmail.trim()} />
            {friends.length === 0 ? <Text style={styles.note}>No saved friends on this phone yet.</Text> : null}
            {friends.map((friend) => (
              <Text key={friend.id} style={styles.note}>{friend.name} · {friend.email}</Text>
            ))}
          </Card>

          <Card>
            <Text style={styles.cardTitle}>Ride together</Text>
            <Text style={styles.note}>
              Split evenly or by distance. Party weekend follows the tailgate switch above.
              Stops save from the campus and airport list. Friend-ride route miles still need the server Maps key.
            </Text>
            <NeighborhoodPicker label="Pickup" value={friendPickup} onChange={setFriendPickup} />
            <NeighborhoodPicker label="Drop-off" value={friendDropoff} onChange={setFriendDropoff} />
            <View style={styles.friendPills}>
              <Pill label="Split evenly" active={splitMode === 'even'} onPress={() => { void tapHaptic(); setSplitMode('even') }} />
              <Pill label="Split by distance" active={splitMode === 'by_distance'} onPress={() => { void tapHaptic(); setSplitMode('by_distance') }} />
            </View>
            <Text style={styles.note}>
              {splitMode === 'even'
                ? 'Even split divides the server route fare. The lobby shows each person’s share, with this route alone struck, before anyone is charged.'
                : 'By distance uses each stop’s weight from the server route. The lobby shows each person’s share before anyone is charged.'}
            </Text>
            <PrimaryButton label={friendBusy ? 'Starting…' : 'Start group ride'} onPress={onRideTogether} disabled={friendBusy} tone="purple" />
          </Card>

          <Card>
            <Text style={styles.cardTitle}>Activity</Text>
            {!user ? <Text style={styles.note}>Sign in to see group rides you organized.</Text> : null}
            {user && activity.length === 0 ? <Text style={styles.note}>No group rides yet.</Text> : null}
            {activity.map((row) => (
              <Text key={row.id} style={styles.note}>
                {row.kind || 'friends'} · {row.status || 'open'}
                {row.split_mode === 'by_distance' ? ' · by distance' : ' · even split'}
                {row.total_fare_cents != null ? ` · ${formatUsd(row.total_fare_cents)}` : ''}
              </Text>
            ))}
            {friendError ? <ErrorText>{friendError}</ErrorText> : null}
            {friendNote ? <Text style={styles.note}>{friendNote}</Text> : null}
          </Card>
        </View>
      </ScrollView>
      <MainTabs active="friends" />
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

function PressOffer({ onPress }: { onPress: () => void }) {
  const styles = useThemedStyles(makeStyles)
  return (
    <Text onPress={onPress} style={styles.offer} accessibilityRole="button">
      I have the car — offer seats
    </Text>
  )
}

function makeStyles(colors: Palette) {
  return {
    screen: { flex: 1, backgroundColor: colors.background },
    scroll: { flex: 1 },
    hero: { paddingHorizontal: 22, paddingBottom: 22 },
    brand: { color: colors.onAccent, fontSize: 12, fontWeight: '800' as const, letterSpacing: 1.4 },
    heroTitle: { color: colors.onAccent, fontSize: 32, fontWeight: '800' as const, letterSpacing: -0.8, marginTop: 8 },
    heroBody: { color: colors.onAccent, fontSize: 15, lineHeight: 22, marginTop: 10 },
    pills: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginTop: 14 },
    pill: {
      color: colors.onAccent,
      backgroundColor: 'rgba(255,255,255,0.16)',
      overflow: 'hidden' as const,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6,
      fontSize: 12,
      fontWeight: '700' as const,
    },
    body: { paddingHorizontal: 20, paddingBottom: 12 },
    note: { marginTop: 8, color: colors.inkSecondary, fontSize: 13, lineHeight: 18 },
    cardTitle: { color: colors.title, fontWeight: '800' as const, fontSize: 16 },
    tailgate: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
      marginBottom: 12,
      marginTop: 4,
    },
    tailgateLabel: { fontWeight: '700' as const, fontSize: 14, color: colors.ink },
    offer: {
      marginTop: 12,
      textAlign: 'center' as const,
      fontWeight: '700' as const,
      color: colors.inkSecondary,
      paddingVertical: 8,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.input,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 16,
      color: colors.ink,
      marginTop: 8,
      marginBottom: 8,
    },
    friendPills: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginTop: 8, marginBottom: 8 },
  }
}
