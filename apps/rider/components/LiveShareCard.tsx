import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, Share, Text, View } from 'react-native'
import { PrimaryButton } from '@/components/Button'
import { useLiveShare } from '@/lib/useLiveShare'
import { supabase } from '@/lib/supabase'
import {
  createLocationShare,
  findActiveLocationShare,
  isShareableTripStatus,
  revokeLocationShare,
  tripShareMessage,
  type LocationShare,
} from 'rides-native/safety.js'
import type { RiderTrip } from '@/lib/useRiderTrip'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

export function LiveShareCard({
  trip,
  userId,
  loading,
}: {
  trip: RiderTrip | null
  userId: string | null
  loading?: boolean
}) {
  const [share, setShare] = useState<LocationShare | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedNote, setCopiedNote] = useState<string | null>(null)
  const live = useLiveShare(share?.id || null)
  const shareable = Boolean(trip && (isShareableTripStatus(trip.status) || !trip.status))
  const finished = Boolean(trip?.status && !isShareableTripStatus(trip.status))
  const waitingOnStatus = Boolean(loading && trip && !trip.status)
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)

  useEffect(() => {
    setShare(null)
    setError(null)
    setCopiedNote(null)
    if (!trip?.id || !shareable || !supabase) return undefined
    let alive = true
    findActiveLocationShare(supabase, trip.id)
      .then((existing) => {
        if (alive && existing) setShare(existing)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : 'Could not load the share link')
      })
    return () => {
      alive = false
    }
  }, [trip?.id, shareable])

  async function ensureShare() {
    if (!trip?.id || !userId || !supabase) {
      setError('Sign in with an active trip to share location')
      return null
    }
    if (share?.token) return share
    const created = await createLocationShare(supabase, trip.id, userId)
    setShare(created)
    return created
  }

  async function onShareLocation() {
    setBusy(true)
    setError(null)
    setCopiedNote(null)
    try {
      const next = await ensureShare()
      if (!next) return
      await Share.share({
        title: 'My Clemson RIDES location',
        message: tripShareMessage({
          pickup: trip?.pickup_label,
          dropoff: trip?.dropoff_label,
          status: trip?.status,
          url: next.url,
        }),
        url: next.url,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not start share'
      if (!/cancel|dismiss/i.test(message)) setError(message)
    } finally {
      setBusy(false)
    }
  }

  async function onShareTrip() {
    setBusy(true)
    setError(null)
    try {
      const next = await ensureShare()
      if (!next) return
      const message = tripShareMessage({
        pickup: trip?.pickup_label,
        dropoff: trip?.dropoff_label,
        status: trip?.status,
        url: next.url,
      })
      await Share.share({ title: 'My Clemson RIDES trip', message, url: next.url })
      setCopiedNote('Trip link ready to send')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not share the trip'
      if (!/cancel|dismiss/i.test(message)) setError(message)
    } finally {
      setBusy(false)
    }
  }

  async function onStop() {
    if (!share?.id || !supabase) return
    setBusy(true)
    setError(null)
    try {
      await revokeLocationShare(supabase, share.id)
      setShare(null)
      setCopiedNote(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not stop sharing')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={[styles.card, lift(colors, 'rest')]}>
      <Text style={styles.kicker}>LIVE LOCATION</Text>
      <Text style={styles.title}>Share my location</Text>
      {loading ? <ActivityIndicator color={colors.orange} style={styles.spinner} /> : null}
      {!loading && !trip ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No active trip</Text>
          <Text style={styles.body}>Request a ride first. The live link turns on while that trip is still going.</Text>
        </View>
      ) : null}
      {!loading && finished ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>This ride is finished</Text>
          <Text style={styles.body}>
            {trip?.pickup_label || 'Pickup'} → {trip?.dropoff_label || 'Dropoff'} is {trip?.status || 'closed'}. Live location is available on an active ride.
          </Text>
        </View>
      ) : null}
      {!waitingOnStatus && shareable && trip ? (
        <>
          <Text style={styles.body}>
            {trip.pickup_label || 'Pickup'} → {trip.dropoff_label || 'Dropoff'}
            {trip.status ? ` · ${trip.status}` : ''}
          </Text>
          <PrimaryButton
            label={busy ? 'Starting…' : share ? 'Share my location again' : 'Share my location'}
            onPress={onShareLocation}
            disabled={busy || !userId}
          />
          <View style={styles.gap} />
          <PrimaryButton
            label="Share trip link"
            onPress={onShareTrip}
            disabled={busy || !userId}
            tone="purple"
          />
          {share?.url ? (
            <Text selectable style={styles.link}>{share.url}</Text>
          ) : (
            <Text style={styles.hint}>The link is a public /share token for this trip. GPS updates while the app is open.</Text>
          )}
          {share ? (
            <Text style={styles.live}>{live.watching ? 'Sharing live GPS' : 'Link is on. Waiting for GPS…'}</Text>
          ) : null}
          {copiedNote ? <Text style={styles.live}>{copiedNote}</Text> : null}
          {share ? (
            <Pressable
              onPress={onStop}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Stop sharing"
              accessibilityHint="Stops live location sharing"
              accessibilityState={{ disabled: busy }}
              hitSlop={16}
            >
              <Text style={styles.stop}>Stop sharing</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {live.error && share ? <Text style={styles.error}>{live.error}</Text> : null}
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    card: {
      backgroundColor: colors.card,
      borderRadius: 20,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
    },
    kicker: { color: colors.orange, fontWeight: '800' as const, letterSpacing: 1.1, fontSize: 11 },
    title: { color: colors.title, fontSize: 20, fontWeight: '800' as const, marginTop: 4, marginBottom: 8 },
    body: { color: colors.inkSecondary, fontSize: 14, lineHeight: 20, marginBottom: 12 },
    empty: {
      backgroundColor: colors.purpleSoft,
      borderRadius: 16,
      padding: 14,
    },
    emptyTitle: { color: colors.title, fontWeight: '800' as const, fontSize: 16, marginBottom: 4 },
    hint: { color: colors.inkSecondary, fontSize: 12, lineHeight: 18, marginTop: 10 },
    link: { color: colors.link, fontSize: 12, lineHeight: 18, marginTop: 12 },
    live: { color: colors.orange, fontWeight: '700' as const, fontSize: 13, marginTop: 8 },
    stop: { color: colors.danger, fontWeight: '700' as const, marginTop: 12 },
    error: { color: colors.danger, fontSize: 13, marginTop: 8 },
    gap: { height: 10 },
    spinner: { marginVertical: 8 },
  }
}
