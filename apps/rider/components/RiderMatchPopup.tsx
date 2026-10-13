import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Modal, Pressable, Text, View } from 'react-native'
import { riderModalClosed, riderModalOpened } from '@/lib/afterModal'
import { PrimaryButton } from '@/components/Button'
import { useAuth } from '@/lib/auth'
import { fetchMatchNotice } from '@/lib/scheduleApi'
import { supabase } from '@/lib/supabase'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'
import { buildRiderMatchNotice } from '../../../shared/nearTermSlots.js'
import { failedHoldPrompt } from 'rides-native/rideMoments'

const MATCHED = ['accepted', 'arriving', 'arrived', 'in_progress']

type Notice = {
  tripId: string
  title: string
  body: string
  driverName: string
  distanceLabel: string | null
  etaLabel: string | null
  pickupLabel: string | null
  holdTitle: string | null
}

type RideHref = { pathname: '/requested'; params: { trip: string } } | { pathname: '/billing' }

/**
 * Full-screen pop-up when a driver matches: name, distance, and pickup time.
 */
export function RiderMatchPopup() {
  const router = useRouter()
  const { user } = useAuth()
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const seen = useRef(new Map<string, string | null>())
  const primed = useRef(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const pending = useRef<RideHref | null>(null)
  const modalOpen = useRef(false)
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null)

  function holdTitleFor(row: { metadata?: object | null }) {
    return failedHoldPrompt({ metadata: row?.metadata ?? null })?.title ?? null
  }

  function closeGate() {
    if (!modalOpen.current) return
    modalOpen.current = false
    riderModalClosed()
  }

  function flushPending() {
    const next = pending.current
    if (!next) return
    pending.current = null
    router.push(next)
  }

  // The push waits until the modal has finished dismissing. Doing both in the
  // same tick crashes UIKit ("present while already presenting"), worse under iOS 26 NativeTabs.
  function dismissThen(href: RideHref | null) {
    pending.current = href
    setNotice(null)
    if (fallback.current) clearTimeout(fallback.current)
    fallback.current = setTimeout(() => {
      fallback.current = null
      closeGate()
      flushPending()
    }, 450)
  }

  function onModalDismiss() {
    if (fallback.current) {
      clearTimeout(fallback.current)
      fallback.current = null
    }
    closeGate()
    flushPending()
  }

  useEffect(() => {
    if (!supabase || !user?.id) return undefined
    let alive = true
    primed.current = false
    seen.current = new Map()
    const client = supabase

    async function present(row: { id: string; pickup_at?: string | null; scheduled_for?: string | null; metadata?: { scheduled_pickup_at?: string } | null }) {
      let next: Notice
      try {
        const fetched = await fetchMatchNotice(row.id)
        next = { ...fetched, tripId: row.id, holdTitle: holdTitleFor(row) }
      } catch {
        const fallbackNotice = buildRiderMatchNotice({
          pickupAt: row.pickup_at || row.scheduled_for || row.metadata?.scheduled_pickup_at,
        })
        next = { ...fallbackNotice, tripId: row.id, holdTitle: holdTitleFor(row) }
      }
      if (alive) {
        if (!modalOpen.current) {
          modalOpen.current = true
          riderModalOpened()
        }
        setNotice(next)
      }
    }

    function consider(row: { id?: string; status?: string | null; driver_id?: string | null; rider_id?: string | null; pickup_at?: string | null; scheduled_for?: string | null; metadata?: { scheduled_pickup_at?: string } | null }) {
      const id = row.id
      if (!id) return
      if (row.rider_id && row.rider_id !== user?.id) return
      const matched = Boolean(row.status && MATCHED.includes(row.status) && row.driver_id)
      const prev = seen.current.get(id)
      seen.current.set(id, row.status || null)
      if (!primed.current || !matched || prev === row.status || prev == null) return
      present({ ...row, id })
    }

    async function load() {
      const { data, error } = await client
        .from('trips')
        .select('id, status, rider_id, driver_id, pickup_at, scheduled_for, metadata')
        .eq('rider_id', user!.id)
        .order('requested_at', { ascending: false })
        .limit(8)
      if (!alive || error) return
      const rows = data || []
      if (!primed.current) {
        rows.forEach((row) => seen.current.set(row.id, row.status))
        primed.current = true
        return
      }
      rows.forEach(consider)
    }

    load()
    const channel = client
      .channel(`rider-match-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips', filter: `rider_id=eq.${user.id}` }, (payload) => {
        consider(payload.new as { id?: string; status?: string | null; driver_id?: string | null })
      })
      .subscribe()
    const poll = setInterval(load, 8000)
    return () => {
      alive = false
      clearInterval(poll)
      client.removeChannel(channel)
    }
  }, [user?.id])

    return (
    <Modal visible={Boolean(notice)} transparent animationType="fade" onDismiss={onModalDismiss} onRequestClose={() => dismissThen(null)}>
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityRole="alert" accessibilityLabel={notice?.body || 'Driver matched'}>
          <Text style={styles.kicker}>MATCHED</Text>
          <Text style={styles.title}>{notice?.title || 'Driver matched'}</Text>
          <Text style={styles.name}>{notice?.driverName || 'Your driver'}</Text>
          <Text style={styles.copy}>
            {notice?.distanceLabel ? `${notice.distanceLabel} from pickup` : 'Distance shows when your driver shares a location.'}
          </Text>
          {notice?.etaLabel ? <Text style={styles.copy}>About {notice.etaLabel} out</Text> : null}
          <Text style={styles.pickup}>{notice?.pickupLabel ? `Pickup ${notice.pickupLabel}` : 'Pickup time follows their ETA.'}</Text>
          {notice?.holdTitle ? (
            <PrimaryButton
              label={notice.holdTitle}
              onPress={() => dismissThen({ pathname: '/billing' })}
            />
          ) : null}
          <PrimaryButton
            label="View ride"
            onPress={() => {
              const id = notice?.tripId
              dismissThen(id ? { pathname: '/requested', params: { trip: id } } : null)
            }}
          />
          <Pressable onPress={() => dismissThen(null)} accessibilityRole="button" accessibilityLabel="Dismiss match">
            <Text style={[styles.dismiss, { color: colors.purple }]}>Dismiss</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

function makeStyles(colors: Palette) {
  return {
    backdrop: {
      flex: 1,
      backgroundColor: colors.scrim,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      padding: 24,
    },
    card: {
      width: '100%' as const,
      maxWidth: 420,
      backgroundColor: colors.card,
      borderRadius: 20,
      padding: 20,
    },
    kicker: { color: colors.orange, fontWeight: '800' as const, letterSpacing: 0.6, fontSize: 12 },
    title: { color: colors.purple, fontWeight: '800' as const, fontSize: 22, marginTop: 6 },
    name: { color: colors.ink, fontWeight: '800' as const, fontSize: 18, marginTop: 8 },
    copy: { color: colors.ink, fontSize: 15, marginTop: 6 },
    pickup: { color: colors.purple, fontWeight: '700' as const, fontSize: 16, marginTop: 8, marginBottom: 16 },
    dismiss: { textAlign: 'center' as const, fontWeight: '700' as const, marginTop: 12 },
  }
}
