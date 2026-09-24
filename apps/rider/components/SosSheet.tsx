import { useEffect, useState } from 'react'
import { Linking, Modal, Pressable, Share, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { readLivePosition } from '@/lib/readLivePosition'
import { supabase } from '@/lib/supabase'
import {
  ALERT_CHANNELS,
  buildSosText,
  contactTel,
  fetchRecentSosEvents,
  isActiveRideStatus,
  logSosEvent,
  sosChannelButton,
  sosChannelHref,
  sosChannelPhrase,
  type EmergencyContact,
  type SosEvent,
} from 'rides-native/safety.js'
import { INK, INK_SECONDARY, ORANGE, PURPLE } from 'rides-native/places.js'

type Phase = 'confirm' | 'channels'

export function SosButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="SOS" onPress={onPress} style={styles.fab}>
      <Text style={styles.fabText}>SOS</Text>
    </Pressable>
  )
}

export function SosIncomingBanner({
  tripId,
  userId,
  active,
}: {
  tripId: string | null
  userId: string | null
  active: boolean
}) {
  const [event, setEvent] = useState<SosEvent | null>(null)
  const [dismissedId, setDismissedId] = useState<string | null>(null)

  useEffect(() => {
    if (!active || !tripId || !supabase) {
      setEvent(null)
      return undefined
    }
    let alive = true
    async function load() {
      const rows = await fetchRecentSosEvents(supabase, tripId as string)
      if (!alive) return
      const incoming = rows.find((row) => row.user_id && row.user_id !== userId) || null
      setEvent(incoming)
    }
    load()
    const timer = setInterval(load, 8000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [active, tripId, userId])

  if (!event || event.id === dismissedId) return null
  return (
    <View style={styles.banner}>
      <View style={styles.bannerCopy}>
        <Text style={styles.bannerKicker}>SOS</Text>
        <Text style={styles.bannerTitle}>Your driver {sosChannelPhrase(event.channel)}</Text>
        <Text style={styles.bannerMeta}>Trip {String(event.trip_id).slice(0, 8)}</Text>
      </View>
      <Pressable accessibilityLabel="Dismiss SOS banner" onPress={() => setDismissedId(event.id)}>
        <Text style={styles.bannerDismiss}>×</Text>
      </Pressable>
    </View>
  )
}

export function SosSheet({
  open,
  onClose,
  tripId,
  tripStatus,
  userId,
  contacts,
}: {
  open: boolean
  onClose: () => void
  tripId: string | null
  tripStatus: string | null
  userId: string | null
  contacts: EmergencyContact[]
}) {
  const insets = useSafeAreaInsets()
  const [phase, setPhase] = useState<Phase>('confirm')
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [locating, setLocating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [logError, setLogError] = useState<string | null>(null)
  const [shareNote, setShareNote] = useState<string | null>(null)
  const canLog = Boolean(tripId && userId && isActiveRideStatus(tripStatus))

  useEffect(() => {
    if (!open) return undefined
    setPhase('confirm')
    setLogError(null)
    setShareNote(null)
    setBusy(false)
    let alive = true
    setLocating(true)
    readLivePosition().then((pos) => {
      if (!alive) return
      if (pos) setCoords(pos)
      setLocating(false)
    })
    return () => {
      alive = false
    }
  }, [open])

  async function onConfirm() {
    if (busy) return
    setBusy(true)
    setLogError(null)
    if (canLog) {
      const result = await logSosEvent(supabase, {
        tripId,
        userId,
        lat: coords?.lat,
        lng: coords?.lng,
        channel: 'banner',
      })
      if (!result.ok) setLogError(result.error)
    }
    setBusy(false)
    setPhase('channels')
  }

  async function onChannel(channel: string) {
    if (busy) return
    setBusy(true)
    setShareNote(null)
    const text = buildSosText({ lat: coords?.lat, lng: coords?.lng, tripId })
    if (canLog) {
      const result = await logSosEvent(supabase, {
        tripId,
        userId,
        lat: coords?.lat,
        lng: coords?.lng,
        channel,
      })
      if (!result.ok) setLogError(result.error)
    }
    try {
      if (channel === 'web_share') {
        await Share.share({ title: 'SOS Clemson RIDES', message: text })
        setShareNote('Location shared.')
      } else {
        const href = sosChannelHref(channel, text)
        if (href) await Linking.openURL(href)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not open that option'
      if (!/cancel|dismiss/i.test(message)) setShareNote(message)
    } finally {
      setBusy(false)
    }
  }

  async function callContact(phone: string) {
    const href = contactTel(phone)
    if (!href) return
    try {
      await Linking.openURL(href)
    } catch (err) {
      setShareNote(err instanceof Error ? err.message : 'Could not start the call')
    }
  }

  const locationLine = coords
    ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
    : locating
      ? 'Getting your location…'
      : 'GPS unavailable. You can still call.'

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 20) }]} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.heading}>Emergency SOS</Text>
          {phase === 'confirm' ? (
            <>
              <Text style={styles.copy}>
                {canLog
                  ? 'This does not call anyone yet. Confirm to alert your driver in the app, then choose 911 or Clemson Police. Your GPS and trip id go with the alert.'
                  : 'There is no active ride to log. You can still call 911 or Clemson Police. Confirm to see those options.'}
              </Text>
              <Text style={styles.meta}>{locationLine}</Text>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={onConfirm}
                style={[styles.confirm, busy && styles.disabled]}
              >
                <Text style={styles.confirmLabel}>{busy ? 'Sending…' : 'Confirm SOS'}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={onClose} style={styles.cancel}>
                <Text style={styles.cancelLabel}>Cancel</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.copy}>
                {canLog
                  ? 'Your driver sees an in-app SOS banner. Pick a way to reach help. Each choice is logged.'
                  : 'These calls are not saved on a trip. If you are in danger, call 911 first.'}
              </Text>
              <Text style={styles.meta}>{locationLine}</Text>
              {ALERT_CHANNELS.map((channel) => {
                const button = sosChannelButton(channel)
                const primary = channel === 'tel_911'
                return (
                  <Pressable
                    key={channel}
                    accessibilityRole="button"
                    onPress={() => onChannel(channel)}
                    style={[styles.action, primary && styles.actionPrimary]}
                  >
                    <Text style={[styles.actionTitle, primary && styles.actionTitlePrimary]}>{button.title}</Text>
                    <Text style={[styles.actionDetail, primary && styles.actionTitlePrimary]}>{button.detail}</Text>
                  </Pressable>
                )
              })}
              {contacts.length === 0 ? (
                <View style={styles.emptyContacts}>
                  <Text style={styles.emptyTitle}>No emergency contacts</Text>
                  <Text style={styles.meta}>Add someone on the Safety screen to call them from here.</Text>
                </View>
              ) : (
                contacts.map((contact) => (
                  <Pressable
                    key={contact.id}
                    accessibilityRole="button"
                    onPress={() => callContact(contact.phone)}
                    style={styles.action}
                  >
                    <Text style={styles.actionTitle}>Call {contact.name}</Text>
                    <Text style={styles.actionDetail}>
                      {contact.relationship ? `${contact.relationship} · ` : ''}{contact.phone}
                    </Text>
                  </Pressable>
                ))
              )}
              {shareNote ? <Text style={styles.meta}>{shareNote}</Text> : null}
              {logError ? (
                <Text style={styles.error}>Could not save the SOS log ({logError}). You can still call 911.</Text>
              ) : null}
              <Pressable accessibilityRole="button" onPress={onClose} style={styles.cancel}>
                <Text style={styles.cancelLabel}>Close</Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#B42318',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#B42318',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  fabText: { color: '#fff', fontWeight: '800', letterSpacing: 0.6 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#3B1020',
    borderRadius: 16,
    padding: 12,
    marginBottom: 12,
  },
  bannerCopy: { flex: 1 },
  bannerKicker: { color: ORANGE, fontWeight: '800', fontSize: 11, letterSpacing: 1 },
  bannerTitle: { color: '#fff', fontWeight: '700', marginTop: 2 },
  bannerMeta: { color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 2 },
  bannerDismiss: { color: '#fff', fontSize: 22, fontWeight: '700', paddingHorizontal: 6 },
  backdrop: { flex: 1, backgroundColor: 'rgba(11,18,32,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  handle: {
    alignSelf: 'center',
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(11,18,32,0.16)',
    marginBottom: 12,
  },
  heading: { fontSize: 24, fontWeight: '800', color: PURPLE, marginBottom: 8 },
  copy: { color: INK, fontSize: 15, lineHeight: 22 },
  meta: { color: INK_SECONDARY, fontSize: 13, marginTop: 8, marginBottom: 12 },
  confirm: { backgroundColor: '#B42318', borderRadius: 16, paddingVertical: 16, alignItems: 'center' },
  confirmLabel: { color: '#fff', fontWeight: '800', fontSize: 16 },
  disabled: { opacity: 0.6 },
  cancel: { paddingVertical: 14, alignItems: 'center' },
  cancelLabel: { color: PURPLE, fontWeight: '700' },
  action: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(82,45,128,0.16)',
    padding: 12,
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  actionPrimary: { backgroundColor: ORANGE, borderColor: ORANGE },
  actionTitle: { color: PURPLE, fontWeight: '800', fontSize: 16 },
  actionTitlePrimary: { color: '#fff' },
  actionDetail: { color: INK_SECONDARY, fontSize: 12, marginTop: 2 },
  emptyContacts: {
    backgroundColor: 'rgba(82,45,128,0.06)',
    borderRadius: 16,
    padding: 12,
    marginBottom: 8,
  },
  emptyTitle: { color: PURPLE, fontWeight: '800' },
  error: { color: '#B42318', fontSize: 13, marginTop: 4 },
})
