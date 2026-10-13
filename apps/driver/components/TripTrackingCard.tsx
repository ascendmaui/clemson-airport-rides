import * as Location from 'expo-location'
import { useEffect, useRef, useState } from 'react'
import { AppState, Linking, Platform, Pressable, Share, Switch, Text, View } from 'react-native'
import {
  createLocationShare,
  findActiveLocationShare,
  postLocationPoint,
  revokeLocationShare,
} from 'rides-native/safety.js'
import {
  backgroundLocationStatusLine,
  readBackgroundLocationPermission,
  toggleDriverTripShare,
} from 'rides-native/safetyCapture.js'
import { driverTrackingCopy } from '../../../shared/safetyHub.js'
import type { SosTrip } from '@/components/SosSheet'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'

type BackgroundPermission = 'granted' | 'denied' | 'unsupported' | 'unknown'

export function TripTrackingCard({ trip }: { trip: SosTrip | null }) {
  const { colors } = useTheme()
  const [enabled, setEnabled] = useState(false)
  const [share, setShare] = useState<{ id: string; url: string; token?: string; active?: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [background, setBackground] = useState<BackgroundPermission>('unknown')
  const touched = useRef(false)

  useEffect(() => {
    let alive = true
    async function refresh() {
      const next = await readBackgroundLocationPermission({
        platform: Platform.OS,
        getBackgroundPermissionsAsync: () => Location.getBackgroundPermissionsAsync(),
      })
      if (alive) setBackground(next)
    }
    void refresh()
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh()
    })
    return () => {
      alive = false
      listener.remove()
    }
  }, [])

  useEffect(() => {
    touched.current = false
    setNote(null)
    setError(null)
    if (!trip?.id || !supabase) {
      setShare(null)
      setEnabled(false)
      return undefined
    }
    let alive = true
    const client = supabase
    findActiveLocationShare(client, trip.id)
      .then((existing) => {
        if (!alive || touched.current) return
        setShare(existing)
        setEnabled(Boolean(existing))
      })
      .catch((err: unknown) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : 'Could not load the share link')
      })
    return () => {
      alive = false
    }
  }, [trip?.id])

  useEffect(() => {
    if (!share?.id || !supabase) return undefined
    let alive = true
    let sub: Location.LocationSubscription | null = null
    const shareId = share.id
    const client = supabase
    async function start() {
      const perm = await Location.requestForegroundPermissionsAsync()
      if (!alive) return
      if (!perm.granted) {
        setError('Location permission is off. The trip link still opens, without live GPS.')
        return
      }
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 15 },
        (pos) => {
          void postLocationPoint(client, {
            shareId,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          }).catch((err: unknown) => {
            if (!alive) return
            setError(err instanceof Error ? err.message : 'Could not post location')
          })
        },
      )
    }
    void start().catch((err: unknown) => {
      if (!alive) return
      setError(err instanceof Error ? err.message : 'GPS is unavailable on this device')
    })
    return () => {
      alive = false
      sub?.remove()
    }
  }, [share?.id])

  async function onToggle(next: boolean) {
    if (busy) return
    touched.current = true
    setBusy(true)
    setEnabled(next)
    setError(null)
    setNote(null)
    try {
      const result = await toggleDriverTripShare({
        enabled: next,
        trip: trip ? {
          id: trip.id,
          status: trip.status,
          riderId: trip.riderId,
          pickupLabel: trip.pickupLabel,
          dropoffLabel: trip.dropoffLabel,
        } : null,
        share,
        createShare: (tripId: string, riderId: string) => {
          if (!supabase) throw new Error('Sign in with an active trip to share location')
          return createLocationShare(supabase, tripId, riderId)
        },
        revokeShare: (shareId: string) => {
          if (!supabase) return Promise.resolve()
          return revokeLocationShare(supabase, shareId)
        },
        presentShare: (payload: { title: string; message: string; url: string }) => Share.share(payload),
      })
      const nextShare = result.share?.id && result.share?.url
        ? { id: String(result.share.id), url: String(result.share.url) }
        : null
      setEnabled(Boolean(result.enabled))
      setShare(nextShare)
      setNote(result.note ? String(result.note) : null)
      setError(result.error ? String(result.error) : null)
    } finally {
      setBusy(false)
    }
  }

  async function onOpenSettings() {
    try {
      await Linking.openSettings()
    } catch {
      setError('Could not open Settings. Open your phone’s Settings to update location permission.')
    }
  }

  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: colors.title, fontWeight: '800', fontSize: 16 }}>Trip tracking</Text>
      <Text style={{ color: colors.inkSecondary, fontSize: 14, lineHeight: 20 }}>{driverTrackingCopy()}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: colors.title, fontWeight: '800' }}>Share live trip location</Text>
          <Text style={{ color: colors.inkSecondary, fontSize: 13, lineHeight: 18 }}>
            Send a link to someone you trust. Location updates while this ride is underway. The link is opt-in and is not a recording upload.
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={(value) => { void onToggle(value) }}
          disabled={busy}
          accessibilityLabel="Share live trip location"
        />
      </View>
      {trip ? (
        <Text style={{ color: colors.inkSecondary, fontSize: 13 }}>
          {trip.pickupLabel || 'Pickup'} → {trip.dropoffLabel || 'Dropoff'} · {trip.status}
        </Text>
      ) : (
        <Text style={{ color: colors.inkSecondary, fontSize: 13 }}>Live tracking is available once a ride is accepted.</Text>
      )}
      {share?.url ? <Text selectable style={{ color: colors.link, fontSize: 12, lineHeight: 18 }}>{share.url}</Text> : null}
      {note ? <Text style={{ color: colors.orange, fontWeight: '700', fontSize: 13 }}>{note}</Text> : null}
      {error ? (
        <Text accessibilityLiveRegion="polite" style={{ color: colors.danger, fontSize: 13, lineHeight: 18 }}>{error}</Text>
      ) : null}
      <Text style={{ color: colors.inkSecondary, fontSize: 13, lineHeight: 18 }}>{backgroundLocationStatusLine(background)}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open Settings"
        onPress={() => { void onOpenSettings() }}
        style={{
          backgroundColor: colors.purple,
          borderRadius: 14,
          minHeight: 48,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: colors.onAccent, fontWeight: '800' }}>Open Settings</Text>
      </Pressable>
    </View>
  )
}
