import { useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CampusMap, type MapPin } from '@/components/CampusMap'
import { ErrorText, Primary, Tag, cardShadow } from '@/components/chrome'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useDriverLocation } from '@/lib/useDriverLocation'
import { fetchDriverApplication, setDriverOnline } from 'rides-native/drivers'
import { displayFirstName } from 'rides-native/authErrors'
import {
  acceptTrip,
  declineTrip,
  loadDriverDesk,
  publishDriverLocation,
  setPriorityMode,
  subscribeTrips,
  type DriverDesk,
} from 'rides-native/driverDesk'
import {
  formatCents,
  formatPickupAt,
  statusHeadline,
  TESLA_FLEET_NOTICE,
  type DriverCard,
} from 'rides-native/tripTags'
import { INK, INK_SECONDARY, ORANGE, PURPLE, SURFACE } from 'rides-native/places.js'

const GATE: Record<string, { title: string; body: string }> = {
  pending_info: {
    title: 'Finish driver signup',
    body: 'Add your info, vehicle, documents, W-9, and contractor agreement. New drivers are not approved automatically.',
  },
  pending_docs: {
    title: 'Upload your documents',
    body: 'License, insurance, registration, car photos, background check, and W-9 come before an admin can review you.',
  },
  pending_review: {
    title: 'Application in review',
    body: 'You cannot go online or accept rides until the application is approved.',
  },
  rejected: {
    title: 'Application needs changes',
    body: 'Update the flagged steps and submit again. You still cannot receive rides.',
  },
  none: {
    title: 'Become a driver',
    body: 'Finish the same onboarding as the web app. An admin approves every new driver.',
  },
}

export default function DriverHome() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user, configured } = useAuth()
  const [desk, setDesk] = useState<DriverDesk | null>(null)
  const [status, setStatus] = useState('none')
  const [reason, setReason] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [self, setSelf] = useState<{ latitude: number; longitude: number } | null>(null)
  const approved = status === 'approved'
  const online = Boolean(desk?.online)
  const name = user ? displayFirstName(user.user_metadata?.full_name || user.email?.split('@')[0], 'Driver') : 'Driver'

  const refresh = useCallback(async () => {
    if (!user || !supabase) return
    const application = await fetchDriverApplication(supabase, user.id)
    const nextStatus = application.application?.onboarding_status || 'none'
    setStatus(nextStatus)
    setReason(application.application?.rejection_reason || null)
    if (application.error) setError(application.error)
    if (nextStatus === 'approved') {
      const loaded = await loadDriverDesk(supabase, user.id)
      setDesk(loaded)
      if (loaded.lat != null && loaded.lng != null) {
        setSelf({ latitude: Number(loaded.lat), longitude: Number(loaded.lng) })
      }
    }
  }, [user])

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : 'Could not load driver home'))
  }, [refresh])

  useEffect(() => {
    if (!supabase || !approved) return undefined
    return subscribeTrips(supabase, () => {
      refresh().catch(() => {})
    })
  }, [approved, refresh])

  useDriverLocation(Boolean(user && approved && online), (fix) => {
    setSelf({ latitude: fix.lat, longitude: fix.lng })
    if (!supabase || !user) return
    publishDriverLocation(supabase, user.id, { ...fix, online: true }).catch(() => {})
  })

  async function toggle() {
    if (!user) {
      router.push('/sign-in')
      return
    }
    if (!approved) {
      router.push('/onboarding')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await setDriverOnline(supabase, user.id, !online)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update online status')
    } finally {
      setBusy(false)
    }
  }

  async function onAccept(card: DriverCard) {
    if (!user || !supabase) return
    setBusy(true)
    setError(null)
    try {
      await acceptTrip(supabase, card, user.id)
      await refresh()
      router.push({ pathname: '/trip', params: { id: card.id } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept')
    } finally {
      setBusy(false)
    }
  }

  async function onDecline(card: DriverCard) {
    if (!supabase) return
    setBusy(true)
    setError(null)
    try {
      await declineTrip(supabase, card.id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not decline')
    } finally {
      setBusy(false)
    }
  }

  async function onPriority() {
    if (!user || !supabase || !desk) return
    try {
      await setPriorityMode(supabase, user.id, !desk.priority)
      setDesk({ ...desk, priority: !desk.priority })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update priority')
    }
  }

  const gate = GATE[status] || GATE.none
  const offer = desk?.offers[0] || null
  const pins: MapPin[] = []
  if (self) pins.push({ id: 'me', ...self, title: 'You', pinColor: ORANGE })
  if (offer?.pickupLat != null && offer.pickupLng != null) {
    pins.push({ id: 'pickup', latitude: offer.pickupLat, longitude: offer.pickupLng, title: 'Pickup', pinColor: PURPLE })
  }

  return (
    <View style={styles.screen}>
      <CampusMap pins={pins.length ? pins : undefined} center={self} />
      <View pointerEvents="box-none" style={styles.overlay}>
        <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
          <View style={styles.brand}>
            <Text style={styles.kicker}>DRIVER</Text>
            <Text style={styles.brandTitle}>Clemson RIDES</Text>
          </View>
          <Pressable onPress={() => router.push('/earnings')} style={styles.earn}>
            <Text style={styles.earnText}>{online ? 'Online' : 'Offline'}</Text>
          </Pressable>
        </View>
        <View style={styles.sheet} pointerEvents="auto">
          <View style={styles.handle} />
          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
            {!configured ? <ErrorText>Add EXPO_PUBLIC_SUPABASE_ANON_KEY as an EAS environment variable, then rebuild.</ErrorText> : null}
            {!user ? (
              <>
                <Text style={styles.title}>Sign in to drive</Text>
                <Text style={styles.copy}>Email and password only. The same Supabase project as the web app.</Text>
                <Primary label="Sign in" onPress={() => router.push('/sign-in')} />
              </>
            ) : !approved ? (
              <>
                <Text style={styles.title}>{gate.title}</Text>
                <Text style={styles.copy}>{gate.body}</Text>
                {reason ? <ErrorText>{reason}</ErrorText> : null}
                <Primary label="Continue application" onPress={() => router.push('/onboarding')} />
              </>
            ) : (
              <>
                <Text style={styles.title}>{online ? `You’re online, ${name}` : `You’re offline, ${name}`}</Text>
                <Text style={styles.copy}>
                  {online
                    ? 'Riders picking a driver can see your name, vehicle, and live pin.'
                    : 'Go online to show up in Pick a driver and receive requests.'}
                </Text>
                {desk?.gameDay ? (
                  <View style={styles.banner}>
                    <Text style={styles.bannerTitle}>Game day · {desk.gameDay.title || 'Live'}</Text>
                    <Text style={styles.copy}>
                      {desk.gameDay.pickup_zone_label || 'Stadium rides'} are in the queue
                      {desk.gameDay.surge_multiplier ? ` · rider surge ${desk.gameDay.surge_multiplier}×` : ''}.
                    </Text>
                  </View>
                ) : null}
                {desk?.vehicle?.is_tesla ? (
                  <Pressable onPress={() => router.push('/fleet')} style={styles.banner}>
                    <Text style={styles.bannerTitle}>Tesla Model 3 listed · stub</Text>
                    <Text style={styles.copy}>{TESLA_FLEET_NOTICE}</Text>
                  </Pressable>
                ) : null}
                {error ? <ErrorText>{error}</ErrorText> : null}
                {desk?.warning ? <ErrorText>{desk.warning}</ErrorText> : null}
                <Primary
                  label={busy ? 'Saving…' : online ? 'Go offline' : 'Go online'}
                  onPress={toggle}
                  disabled={busy}
                />
                {desk?.active ? (
                  <Pressable onPress={() => router.push({ pathname: '/trip', params: { id: desk.active!.id } })} style={styles.live}>
                    <Text style={styles.liveKicker}>LIVE TRIP</Text>
                    <Text style={styles.liveTitle}>{statusHeadline(desk.active.status)}</Text>
                    <Text style={styles.copy}>{desk.active.pickupLabel} → {desk.active.dropoffLabel}</Text>
                  </Pressable>
                ) : null}
                {offer && !desk?.active ? (
                  <RideCard card={offer} busy={busy} onAccept={() => onAccept(offer)} onDecline={() => onDecline(offer)} />
                ) : null}
                <View style={styles.linkRow}>
                  <LinkPill label="Queue" onPress={() => router.push('/queue')} />
                  <LinkPill label="Earnings" onPress={() => router.push('/earnings')} />
                  <LinkPill label="Tesla fleet" onPress={() => router.push('/fleet')} />
                  <LinkPill label="Account" onPress={() => router.push('/account')} />
                </View>
                <Pressable onPress={onPriority} style={styles.priority}>
                  <View>
                    <Text style={styles.priorityTitle}>Priority mode</Text>
                    <Text style={styles.copy}>Marks your driver_status row. Higher-value matching still happens on the server.</Text>
                  </View>
                  <View style={[styles.switch, desk?.priority && styles.switchOn]}>
                    <View style={[styles.knob, desk?.priority && styles.knobOn]} />
                  </View>
                </Pressable>
                {(desk?.scheduledOpen.length || 0) > 0 ? (
                  <Text style={styles.queueHint}>{desk?.scheduledOpen.length} scheduled ride{desk?.scheduledOpen.length === 1 ? '' : 's'} waiting in the queue.</Text>
                ) : null}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </View>
  )
}

function RideCard({
  card,
  busy,
  onAccept,
  onDecline,
}: {
  card: DriverCard
  busy: boolean
  onAccept: () => void
  onDecline: () => void
}) {
  const opacity = useState(() => new Animated.Value(0))[0]
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 280, useNativeDriver: true }).start()
  }, [opacity])
  return (
    <Animated.View style={[styles.offer, { opacity }]}>
      <Text style={styles.offerFare}>{formatCents(card.driverNetCents)}</Text>
      <Text style={styles.copy}>{statusHeadline(card.status)} · you net 80%</Text>
      <View style={styles.tags}>
        {card.tagLabels.map((label) => (
          <Tag key={label} label={label} tone={label.includes('Tesla') || label.includes('Game') ? 'orange' : 'purple'} />
        ))}
      </View>
      <Text style={styles.place}>Pickup · {card.pickupLabel}</Text>
      <Text style={styles.place}>Drop-off · {card.dropoffLabel}</Text>
      {card.pickupAt ? <Text style={styles.copy}>{formatPickupAt(card.pickupAt)}</Text> : null}
      {card.depositCents > 0 ? (
        <Text style={styles.copy}>25% deposit on this fare · {formatCents(card.depositCents)}</Text>
      ) : null}
      {card.teslaStub ? <Text style={styles.copy}>{TESLA_FLEET_NOTICE}</Text> : null}
      <Primary label={busy ? 'Saving…' : 'Accept'} onPress={onAccept} disabled={busy} tone="purple" />
      <Pressable onPress={onDecline} disabled={busy} style={styles.decline}>
        <Text style={styles.declineText}>Decline</Text>
      </Pressable>
    </Animated.View>
  )
}

function LinkPill({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.pill}>
      <Text style={styles.pillText}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SURFACE },
  overlay: { ...StyleSheet.absoluteFill, justifyContent: 'space-between' },
  top: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16 },
  brand: { backgroundColor: PURPLE, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 12, ...cardShadow },
  kicker: { color: ORANGE, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  brandTitle: { color: '#fff', fontSize: 18, fontWeight: '800', marginTop: 2 },
  earn: { backgroundColor: '#fff', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10, alignSelf: 'flex-start', ...cardShadow },
  earnText: { color: PURPLE, fontWeight: '800' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '62%',
    paddingHorizontal: 18,
    paddingBottom: 18,
    ...cardShadow,
  },
  sheetScroll: { flexGrow: 0 },
  sheetContent: { gap: 12, paddingBottom: 8 },
  handle: { alignSelf: 'center', width: 42, height: 5, borderRadius: 999, backgroundColor: 'rgba(11,18,32,0.16)', marginVertical: 10 },
  title: { fontSize: 24, fontWeight: '800', color: PURPLE, letterSpacing: -0.3 },
  copy: { color: INK_SECONDARY, fontSize: 14, lineHeight: 20 },
  banner: { backgroundColor: 'rgba(245,102,0,0.1)', borderRadius: 16, padding: 12, gap: 4 },
  bannerTitle: { color: PURPLE, fontWeight: '800' },
  live: { backgroundColor: PURPLE, borderRadius: 18, padding: 14, gap: 4 },
  liveKicker: { color: ORANGE, fontWeight: '800', fontSize: 11, letterSpacing: 1 },
  liveTitle: { color: '#fff', fontWeight: '800', fontSize: 18 },
  offer: { gap: 8, paddingTop: 4 },
  offerFare: { fontSize: 32, fontWeight: '800', color: INK, letterSpacing: -0.6 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  place: { color: INK, fontWeight: '700' },
  decline: { alignItems: 'center', paddingVertical: 8 },
  declineText: { color: INK_SECONDARY, fontWeight: '700' },
  linkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { backgroundColor: SURFACE, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  pillText: { color: PURPLE, fontWeight: '800', fontSize: 13 },
  priority: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, alignItems: 'center' },
  priorityTitle: { color: INK, fontWeight: '800' },
  switch: { width: 52, height: 30, borderRadius: 999, backgroundColor: '#E6E1EA', padding: 3 },
  switchOn: { backgroundColor: PURPLE },
  knob: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff' },
  knobOn: { marginLeft: 22 },
  queueHint: { color: PURPLE, fontWeight: '700' },
})
