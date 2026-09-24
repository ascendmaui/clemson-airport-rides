import { LinearGradient } from 'expo-linear-gradient'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useRef, useState } from 'react'
import { Animated, Linking, Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { warningHaptic } from '@/lib/feedback'
import { readLivePosition } from '@/lib/readLivePosition'
import { setSosEngaged } from '@/lib/sosEngaged'
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
import { useTheme } from '@/lib/theme'

const MORE_CHANNELS = ALERT_CHANNELS.filter((channel) => channel !== 'tel_911' && channel !== 'tel_cupd')

export function SosButton({ onPress }: { onPress: () => void }) {
  const { colors } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="SOS"
      onPress={onPress}
      style={[styles.fab, { backgroundColor: colors.danger, shadowColor: colors.danger }]}
    >
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

  const { colors } = useTheme()
  if (!event || event.id === dismissedId) return null
  return (
    <View style={styles.banner}>
      <View style={styles.bannerCopy}>
        <Text style={[styles.bannerKicker, { color: colors.orange }]}>SOS</Text>
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
  const breathe = useRef(new Animated.Value(0.12)).current
  const [armed, setArmed] = useState(false)
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [locating, setLocating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [logError, setLogError] = useState<string | null>(null)
  const [shareNote, setShareNote] = useState<string | null>(null)
  const canLog = Boolean(tripId && userId && isActiveRideStatus(tripStatus))

  useEffect(() => {
    setSosEngaged(open)
    if (!open) return () => setSosEngaged(false)
    void warningHaptic()
    setArmed(false)
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
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 0.38, duration: 1400, useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0.1, duration: 1400, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => {
      alive = false
      loop.stop()
      setSosEngaged(false)
    }
  }, [breathe, open])

  async function armSos() {
    if (busy || armed) return
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
    setArmed(true)
    setShareNote('Confirmed. Press the button again to call.')
  }

  async function onPolice(channel: 'tel_911' | 'tel_cupd') {
    if (busy) return
    if (!armed) {
      await armSos()
      return
    }
    await onChannel(channel)
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

  const callHint = armed
    ? 'Dials now and logs the call on this trip.'
    : 'Confirms the alert. Does not dial until you press again.'

  return (
    <Modal
      visible={open}
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.emergency} accessibilityViewIsModal>
        <StatusBar style="light" />
        <LinearGradient colors={['#4A0C0C', '#B42318', '#6E1212']} style={StyleSheet.absoluteFill} />
        <Animated.View pointerEvents="none" style={[styles.breathe, { opacity: breathe }]} />
        <ScrollView
          contentContainerStyle={[
            styles.emergencyBody,
            { paddingTop: insets.top + 8, paddingBottom: Math.max(insets.bottom, 24) },
          ]}
        >
          <View style={styles.emergencyTop}>
            <Text style={styles.emergencyKicker}>EMERGENCY</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close SOS" onPress={onClose} hitSlop={8}>
              <Text style={styles.close}>Close</Text>
            </Pressable>
          </View>
          <Text style={styles.emergencyTitle}>Press the button to call police</Text>
          <Text style={styles.emergencyCopy}>
            {armed
              ? canLog
                ? 'Your driver has the in-app SOS. Press Call 911 or Call Clemson Police to dial.'
                : 'Press Call 911 or Call Clemson Police to dial. This ride is not logging an in-app alert.'
              : canLog
                ? 'The first press confirms and alerts your driver. It does not dial.'
                : 'The first press confirms. It does not dial. There is no active ride to log.'}
          </Text>
          <Text style={styles.emergencyMeta}>{locationLine}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Call 911"
            accessibilityHint={callHint}
            disabled={busy}
            onPress={() => { void onPolice('tel_911') }}
            style={[styles.call911, busy && styles.disabled]}
          >
            <Text style={styles.call911Label}>{busy && !armed ? 'Confirming…' : 'Call 911'}</Text>
            <Text style={styles.call911Detail}>
              {armed ? 'Emergency voice call' : 'Tap to confirm · does not dial yet'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Call Clemson Police"
            accessibilityHint={callHint}
            disabled={busy}
            onPress={() => { void onPolice('tel_cupd') }}
            style={[styles.callPolice, busy && styles.disabled]}
          >
            <Text style={styles.callPoliceLabel}>Call Clemson Police</Text>
            <Text style={styles.callPoliceDetail}>
              {armed ? 'Campus safety' : 'Tap to confirm · does not dial yet'}
            </Text>
          </Pressable>
          {armed ? (
            <>
              {MORE_CHANNELS.map((channel) => {
                const button = sosChannelButton(channel)
                return (
                  <Pressable
                    key={channel}
                    accessibilityRole="button"
                    onPress={() => { void onChannel(channel) }}
                    style={styles.more}
                  >
                    <Text style={styles.moreTitle}>{button.title}</Text>
                    <Text style={styles.moreDetail}>{button.detail}</Text>
                  </Pressable>
                )
              })}
              {contacts.length === 0 ? (
                <View style={styles.more}>
                  <Text style={styles.moreTitle}>No emergency contacts</Text>
                  <Text style={styles.moreDetail}>Add someone on the Safety screen to call them from here.</Text>
                </View>
              ) : (
                contacts.map((contact) => (
                  <Pressable
                    key={contact.id}
                    accessibilityRole="button"
                    onPress={() => { void callContact(contact.phone) }}
                    style={styles.more}
                  >
                    <Text style={styles.moreTitle}>Call {contact.name}</Text>
                    <Text style={styles.moreDetail}>
                      {contact.relationship ? `${contact.relationship} · ` : ''}{contact.phone}
                    </Text>
                  </Pressable>
                ))
              )}
            </>
          ) : null}
          {shareNote ? <Text style={styles.emergencyMeta}>{shareNote}</Text> : null}
          {logError ? (
            <Text style={styles.emergencyError}>Could not save the SOS log ({logError}). You can still call 911.</Text>
          ) : null}
        </ScrollView>
      </View>
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
  bannerKicker: { color: '#F56600', fontWeight: '800', fontSize: 11, letterSpacing: 1 },
  bannerTitle: { color: '#fff', fontWeight: '700', marginTop: 2 },
  bannerMeta: { color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 2 },
  bannerDismiss: { color: '#fff', fontSize: 22, fontWeight: '700', paddingHorizontal: 6 },
  emergency: { flex: 1, backgroundColor: '#6E1212' },
  breathe: { ...StyleSheet.absoluteFill, backgroundColor: '#FF8A75' },
  emergencyBody: { paddingHorizontal: 22, gap: 12, flexGrow: 1 },
  emergencyTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  emergencyKicker: { color: '#FFE4DC', fontWeight: '800', letterSpacing: 1.6, fontSize: 13 },
  close: { color: '#fff', fontWeight: '700', fontSize: 16 },
  emergencyTitle: {
    color: '#fff',
    fontSize: 36,
    lineHeight: 42,
    fontWeight: '800',
    letterSpacing: -0.8,
    marginTop: 12,
  },
  emergencyCopy: { color: 'rgba(255,255,255,0.92)', fontSize: 17, lineHeight: 24 },
  emergencyMeta: { color: 'rgba(255,255,255,0.78)', fontSize: 14, lineHeight: 20 },
  call911: {
    backgroundColor: '#fff',
    borderRadius: 28,
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    paddingHorizontal: 20,
    marginTop: 8,
    shadowColor: '#3B0707',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  call911Label: { color: '#9B1B1B', fontSize: 28, fontWeight: '800', letterSpacing: -0.4 },
  call911Detail: { color: '#9B1B1B', fontSize: 14, fontWeight: '600', marginTop: 4 },
  callPolice: {
    borderRadius: 24,
    minHeight: 76,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.85)',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  callPoliceLabel: { color: '#fff', fontSize: 20, fontWeight: '800' },
  callPoliceDetail: { color: 'rgba(255,255,255,0.84)', fontSize: 13, fontWeight: '600', marginTop: 2 },
  more: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  moreTitle: { color: '#fff', fontWeight: '800', fontSize: 16 },
  moreDetail: { color: 'rgba(255,255,255,0.78)', fontSize: 13, marginTop: 2 },
  disabled: { opacity: 0.6 },
  emergencyError: { color: '#FFE4DC', fontSize: 14, lineHeight: 20, fontWeight: '700' },
})
