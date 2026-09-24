import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RefreshControl, ScrollView, Share, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { CarpoolCompare } from '@/components/carpool/CarpoolCompare'
import { NeighborhoodPicker } from '@/components/carpool/NeighborhoodPicker'
import { BackButton, Card, EmptyState, ErrorText, Field, SkeletonBlock, SplitModePicker } from '@/components/carpool/ui'
import { MainTabs } from '@/components/MainTabs'
import { useAuth } from '@/lib/auth'
import { oneParam } from '@/lib/oneParam'
import { supabase } from '@/lib/supabase'
import {
  apiErrorMessage,
  confirmFriendCharges,
  getFriendRide,
  inviteUrl,
  joinFriendRide,
  recomputeFriendRide,
  type RideSummary,
} from 'rides-native/shared/carpoolApi.js'
import {
  defaultCarpoolEnds,
  formatEta,
  formatMiles,
  formatUsd,
  riderDisplayName,
  surgeDelta,
  type Place,
} from 'rides-native/shared/carpool.js'
import { liveCarpoolQuote, selfParticipantId, splitRows } from 'rides-native/shared/split.js'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

const START = defaultCarpoolEnds()

function asSplit(value: string | undefined): 'even' | 'by_distance' {
  return value === 'by_distance' ? 'by_distance' : 'even'
}

function asPlace(stop: { label?: string; lat?: number; lng?: number } | null | undefined, fallback: Place): Place {
  if (stop?.lat == null || stop.lng == null) return fallback
  return { label: stop.label || fallback.label, lat: stop.lat, lng: stop.lng }
}

export default function CarpoolLobbyScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ token?: string }>()
  const token = oneParam(params.token)
  const { user } = useAuth()
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [ride, setRide] = useState<RideSummary | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyLabel, setBusyLabel] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [name, setName] = useState(riderDisplayName(user))
  const [pickup, setPickup] = useState<Place>(START.pickup)
  const [dropoff, setDropoff] = useState<Place>(START.dropoff)
  const [splitMode, setSplitMode] = useState<'even' | 'by_distance'>('even')
  const seeded = useRef(false)
  const missing = useRef(false)

  const load = useCallback(async () => {
    if (!token || missing.current) return
    try {
      const next = await getFriendRide(supabase, token)
      setRide(next)
      setLoadError(null)
    } catch (err) {
      setLoadError(apiErrorMessage(err))
      const status = err && typeof err === 'object' && 'status' in err ? Number((err as { status?: number }).status) : 0
      if (status === 404) missing.current = true
    }
  }, [token])

  useEffect(() => {
    missing.current = false
    void load()
    if (!token) return undefined
    const timer = setInterval(() => {
      void load()
    }, 8000)
    return () => clearInterval(timer)
  }, [load, token])

  useEffect(() => {
    if (!ride || seeded.current) return
    const self = ride.participants?.find((row) => row.is_self) || ride.participants?.[0]
    setPickup(asPlace(self?.pickup, START.pickup))
    setDropoff(asPlace(self?.dropoff, START.dropoff))
    setSplitMode(asSplit(ride.split_mode))
    seeded.current = true
  }, [ride])

  const quote = useMemo(() => (ride ? liveCarpoolQuote(ride) : null), [ride])
  const rows = useMemo(() => (ride ? splitRows(ride) : []), [ride])
  const selfId = selfParticipantId(ride)
  const self = ride?.participants?.find((row) => row.is_self)
  const hopPickup = asPlace(self?.pickup, pickup)
  const hopDropoff = asPlace(self?.dropoff, dropoff)
  const delta = useMemo(
    () => surgeDelta({ pickup: hopPickup, dropoff: hopDropoff, quote, selfId }),
    [hopPickup, hopDropoff, quote, selfId],
  )
  const cap = Number(ride?.max_participants) || 4
  const count = ride?.participants?.length || 0
  const isOrganizer = Boolean(ride?.is_organizer)

  async function onShare() {
    try {
      await Share.share({ message: inviteUrl(token, ride?.kind === 'friends' ? 'friends' : 'carpool') })
    } catch (err) {
      setError(apiErrorMessage(err))
    }
  }

  async function onJoin() {
    const alreadyIn = (ride?.participants || []).some((row) => row.is_self || (user?.id && row.user_id === user.id))
    if (!alreadyIn && count >= cap) {
      setError(`This ride is full (${cap} max for this vehicle).`)
      return
    }
    setBusy(true)
    setBusyLabel('Saving…')
    setError(null)
    try {
      await joinFriendRide(supabase, {
        token,
        displayName: name || 'Tiger',
        email: user?.email || undefined,
        pickup,
        dropoff,
      })
      try {
        setBusyLabel('Calculating fares…')
        await recomputeFriendRide(supabase, token, splitMode)
        setHint(null)
      } catch (err) {
        setHint(apiErrorMessage(err))
      }
      await load()
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setBusy(false)
      setBusyLabel('')
    }
  }

  async function onRecompute() {
    setBusy(true)
    setBusyLabel('Calculating fares…')
    setError(null)
    try {
      await recomputeFriendRide(supabase, token, splitMode)
      await load()
      setHint(null)
    } catch (err) {
      const message = apiErrorMessage(err)
      setHint(message)
      setError(message)
    } finally {
      setBusy(false)
      setBusyLabel('')
    }
  }

  async function onConfirm() {
    setBusy(true)
    setError(null)
    try {
      setBusyLabel('Calculating fares…')
      try {
        await recomputeFriendRide(supabase, token, splitMode)
        await load()
        setHint(null)
      } catch (err) {
        setHint(apiErrorMessage(err))
        if (!ride?.total_fare_cents) {
          setError(apiErrorMessage(err))
          return
        }
      }
      setBusyLabel('Charging…')
      const data = await confirmFriendCharges(supabase, token)
      await load()
      if (data.booked) {
        const assigned = data.trip?.driver_id || ride?.driver_profile_id
        setHint(
          assigned
            ? `Booked trip ${data.trip?.id || ''} - driver assigned (carpool organizer).`
            : `Booked trip ${data.trip?.id || ''} - searching for a driver.`,
        )
      } else if (data.paymentElementSecrets?.length) {
        setHint('Some riders need to finish payment (saved card missing or requires authentication).')
      }
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setBusy(false)
      setBusyLabel('')
    }
  }

  const confirmLabel = ride?.status === 'booked'
    ? 'Booked'
    : busy
      ? (busyLabel || 'Working…')
      : delta?.currentShareCents != null
        ? `Confirm · charge ${formatUsd(delta.currentShareCents)} each`
        : 'Waiting for the split'

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 20, paddingBottom: 28 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.orange}
            onRefresh={() => {
              setRefreshing(true)
              load().finally(() => setRefreshing(false))
            }}
          />
        )}
      >
        <BackButton onPress={() => (router.canGoBack() ? router.back() : router.replace('/friends'))} />
        <Text style={styles.title}>
          {ride?.kind === 'friends'
            ? (isOrganizer ? 'Friend ride lobby' : 'Join friend ride')
            : (isOrganizer ? 'Carpool lobby' : 'Join carpool')}
        </Text>
        {!ride && !loadError ? (
          <Card>
            <SkeletonBlock height={18} width="40%" />
            <View style={{ height: 12 }} />
            <SkeletonBlock height={64} />
            <View style={{ height: 12 }} />
            <SkeletonBlock height={14} />
            <View style={{ height: 8 }} />
            <SkeletonBlock height={14} width="75%" />
          </Card>
        ) : null}
        {loadError && !ride ? (
          <EmptyState title="This carpool link is not active" body={loadError} />
        ) : null}
        {ride ? (
          <>
            <Text style={styles.status}>Status: {ride.status || '…'}</Text>
            {(ride.distance_m || ride.total_fare_cents) ? (
              <View style={styles.stats}>
                <Stat label="Distance" value={formatMiles(ride.distance_m || 0)} />
                <Stat label="ETA" value={formatEta(ride.duration_s || 0)} />
                <Stat label="Total" value={formatUsd(ride.total_fare_cents || 0)} />
              </View>
            ) : null}
            {hint ? <Text style={styles.hint}>{hint}</Text> : null}

            <Card>
              <Text style={styles.cardTitle}>Invite link</Text>
              <Text style={styles.linkText}>{inviteUrl(token, ride.kind === 'friends' ? 'friends' : 'carpool')}</Text>
              <Text accessibilityRole="button" onPress={onShare} style={styles.link}>Copy / share →</Text>
            </Card>

            <Card>
              <Text style={styles.cardTitle}>Fare split</Text>
              {rows.length === 0 ? (
                <EmptyState
                  title="Split not priced yet"
                  body={ride.kind === 'friends'
                    ? 'Stops are saved. Friend-ride miles come from Google Routes, which needs the server Maps key before the split can lock.'
                    : 'The split shows up once every rider has a pickup and dropoff. Optimize the route to lock the shares. Campus distance still prices the card if Google Routes is unavailable.'}
                />
              ) : rows.map((row) => (
                <View key={row.id} style={styles.splitLine}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.person}>{row.name}</Text>
                    {row.soloCents != null ? (
                      <Text style={styles.solo}>Alone {formatUsd(row.soloCents)}</Text>
                    ) : null}
                  </View>
                  <View style={styles.splitMoney}>
                    <Text style={styles.share}>{formatUsd(row.shareCents)}</Text>
                    {row.savingsCents != null && row.savingsCents > 0 ? (
                      <Text style={styles.save}>Save {formatUsd(row.savingsCents)}</Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </Card>

            <Card>
              <Text style={styles.cardTitle}>Participants ({count}/{cap})</Text>
              <Text style={styles.meta}>
                Max {cap} for this vehicle{ride.vehicle_label ? ` · ${ride.vehicle_label}` : ''}.
              </Text>
              {count === 0 ? (
                <EmptyState title="No riders yet" body="Share the link. First names show up here as people join." />
              ) : null}
              {count === 1 ? (
                <Text style={styles.meta}>You’re the only rider so far. Share the link to fill the other seats. Stranger matching still stops at 4.</Text>
              ) : null}
              {(ride.participants || []).map((person) => (
                <View key={person.id} style={styles.personBlock}>
                  <View style={styles.personRow}>
                    <Text style={styles.person}>{person.display_name}</Text>
                    <Text style={styles.meta}>· {person.status}</Text>
                    {person.student_verified_at ? <Text style={styles.badge}>Clemson student</Text> : null}
                    {person.rating_avg != null ? (
                      <Text style={styles.meta}>★ {Number(person.rating_avg).toFixed(1)}{person.rating_count ? ` (${person.rating_count})` : ''}</Text>
                    ) : null}
                  </View>
                  <Text style={styles.meta}>{person.pickup?.label || '—'} → {person.dropoff?.label || '—'}</Text>
                </View>
              ))}
            </Card>

            <Card>
              <Text style={styles.cardTitle}>{isOrganizer ? 'Update stops' : 'Add your stops'}</Text>
              <Field label="Name" value={name} onChangeText={setName} />
              <NeighborhoodPicker label="Pickup" value={pickup} onChange={setPickup} />
              <NeighborhoodPicker label="Dropoff" value={dropoff} onChange={setDropoff} />
              {!isOrganizer ? (
                <CarpoolCompare pickup={hopPickup} dropoff={hopDropoff} quote={quote} selfId={selfId} mode="confirm" />
              ) : null}
              <View style={{ height: 12 }} />
              <PrimaryButton label={busy ? (busyLabel || 'Saving…') : 'Save stops'} onPress={onJoin} disabled={busy} />
            </Card>

            {isOrganizer ? (
              <Card>
                <Text style={styles.cardTitle}>Organizer</Text>
                <SplitModePicker value={splitMode} onChange={setSplitMode} />
                <PrimaryButton
                  label={busy && busyLabel === 'Calculating fares…' ? 'Calculating fares…' : 'Optimize route & fares'}
                  onPress={onRecompute}
                  disabled={busy}
                  tone="purple"
                />
                <CarpoolCompare pickup={hopPickup} dropoff={hopDropoff} quote={quote} selfId={selfId} mode="confirm" />
                <View style={{ height: 12 }} />
                <PrimaryButton
                  label={confirmLabel}
                  onPress={onConfirm}
                  disabled={busy || ride.status === 'booked' || !quote}
                />
                <Text style={styles.meta}>
                  Confirm updates fares from the live route, then charges full shares · saved card or Apple Pay / Payment Element.
                  Books when all Paid · you are the assigned driver.
                </Text>
              </Card>
            ) : null}

            {ride.trip_id ? (
              <Card>
                <Text style={styles.cardTitle}>{ride.kind === 'carpool' || ride.driver_profile_id ? 'Driver assigned' : 'Driver searching'}</Text>
                <Text accessibilityRole="button" onPress={() => router.push({ pathname: '/requested', params: { trip: ride.trip_id || '' } })} style={styles.link}>
                  Open trip →
                </Text>
              </Card>
            ) : null}
            {error ? <ErrorText>{error}</ErrorText> : null}
          </>
        ) : null}
      </ScrollView>
      <MainTabs active="friends" />
    </View>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  const styles = useThemedStyles(makeStyles)
  return (
    <View style={styles.stat}>
      <Text style={styles.meta}>{label}</Text>
      <Text style={styles.person}>{value}</Text>
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    screen: { flex: 1, backgroundColor: colors.background },
    scroll: { flex: 1 },
    title: { fontSize: 28, fontWeight: '800' as const, color: colors.title, letterSpacing: -0.4 },
    status: { marginTop: 6, color: colors.inkSecondary, fontSize: 13 },
    stats: {
      marginTop: 16,
      padding: 16,
      borderRadius: 16,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      flexDirection: 'row' as const,
      gap: 8,
    },
    stat: { flex: 1 },
    hint: { marginTop: 10, color: colors.orange, fontSize: 13, lineHeight: 18 },
    cardTitle: { color: colors.title, fontWeight: '800' as const, fontSize: 16, marginBottom: 8 },
    linkText: { color: colors.inkSecondary, fontSize: 12 },
    link: { marginTop: 8, color: colors.link, fontWeight: '800' as const },
    splitLine: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 8,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    person: { fontWeight: '700' as const, color: colors.ink, fontSize: 14 },
    solo: { color: colors.inkSecondary, fontSize: 12, textDecorationLine: 'line-through' as const, marginTop: 2 },
    splitMoney: { alignItems: 'flex-end' as const },
    share: { color: colors.orange, fontWeight: '800' as const, fontSize: 16 },
    save: { color: colors.orange, fontSize: 11, fontWeight: '700' as const },
    meta: { color: colors.inkSecondary, fontSize: 12, lineHeight: 18, marginTop: 4 },
    personBlock: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
    personRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, alignItems: 'center' as const, gap: 6 },
    badge: {
      fontSize: 10,
      fontWeight: '800' as const,
      color: colors.link,
      backgroundColor: colors.purpleSoft,
      overflow: 'hidden' as const,
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
  }
}
