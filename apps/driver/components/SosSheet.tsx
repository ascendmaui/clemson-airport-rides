import { useEffect, useMemo, useState } from 'react'
import { Linking, Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { buildSosText, CUPD_PHONE_DISPLAY, isActiveRideStatus, logSosEvent, sosChannelHref, tripShareMessage, type SosChannel } from 'rides-native/safety.js'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import type { Palette } from '@/lib/palette'

export type SosTrip = {
  id: string
  status: string
  pickupLabel?: string | null
  dropoffLabel?: string | null
}

export function SosButton({ onPress }: { onPress: () => void }) {
  const { colors, scheme } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Emergency SOS"
      accessibilityHint="Opens emergency calls and trip sharing"
      onPress={onPress}
      style={[buttonStyles.button, { backgroundColor: colors.danger }]}
    >
      <Text style={[buttonStyles.label, { color: scheme === 'dark' ? colors.background : colors.onAccent }]}>SOS</Text>
    </Pressable>
  )
}

export function SosSheet({ open, onClose, trip, userId, fix }: {
  open: boolean
  onClose: () => void
  trip: SosTrip | null
  userId: string | null
  fix: { lat: number; lng: number } | null
}) {
  const insets = useSafeAreaInsets()
  const { colors, scheme } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [logError, setLogError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const live = Boolean(trip && isActiveRideStatus(trip.status))

  useEffect(() => {
    setLogError(null)
    setActionError(null)
  }, [open, trip?.id])

  function onAction(channel: SosChannel) {
    if (!trip || !live) return
    setLogError(null)
    setActionError(null)
    // Start logging independently: an offline or stalled request must never delay dialing.
    void logSosEvent(supabase, {
      userId,
      tripId: trip.id,
      lat: fix?.lat,
      lng: fix?.lng,
      channel,
    }).then((result) => {
      if (!result.ok) setLogError('Could not save the SOS event. Emergency calls and sharing are still available.')
    }).catch(() => setLogError('Could not save the SOS event. Emergency calls and sharing are still available.'))

    const text = buildSosText({ lat: fix?.lat, lng: fix?.lng, tripId: trip.id })
    const action = channel === 'web_share'
      ? Share.share({
        title: 'SOS Clemson RIDES',
        message: `${tripShareMessage({ pickup: trip.pickupLabel, dropoff: trip.dropoffLabel, status: trip.status })}\n\n${text}`,
      })
      : Linking.openURL(sosChannelHref(channel, text)!)
    void action.catch(() => setActionError(channel === 'web_share' ? 'Could not open sharing. Try again.' : 'Could not open the phone app. Dial the number directly.'))
  }

  if (!live) return null
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: insets.bottom + 16, maxHeight: '90%' }]}>
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.header}>
              <Text accessibilityRole="header" style={styles.title}>Emergency SOS</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close SOS" onPress={onClose} style={styles.close}>
                <Text style={styles.closeText}>Close</Text>
              </Pressable>
            </View>
            <Text style={styles.body}>Call for help or share this trip and your latest location with someone you trust.</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Call 911" onPress={() => onAction('tel_911')} style={[styles.action, { backgroundColor: colors.danger }]}>
              <Text style={[styles.actionText, { color: scheme === 'dark' ? colors.background : colors.onAccent }]}>Call 911</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Call Clemson University Police" onPress={() => onAction('tel_cupd')} style={styles.action}>
              <Text style={styles.actionText}>Call Clemson University Police</Text>
              <Text style={styles.phone}>{CUPD_PHONE_DISPLAY}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Share trip with a contact" onPress={() => onAction('web_share')} style={styles.action}>
              <Text style={styles.actionText}>Share trip with a contact</Text>
            </Pressable>
            {logError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{logError}</Text> : null}
            {actionError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{actionError}</Text> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const buttonStyles = StyleSheet.create({
  button: { minWidth: 64, minHeight: 48, paddingHorizontal: 16, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 16, fontWeight: '800' },
})

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.scrim },
    sheet: { backgroundColor: colors.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 18 },
    content: { gap: 14 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    title: { flex: 1, color: colors.ink, fontSize: 22, fontWeight: '800' },
    close: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    closeText: { color: colors.title, fontWeight: '700' },
    body: { color: colors.inkSecondary, fontSize: 14, lineHeight: 20 },
    action: { minHeight: 56, padding: 14, borderRadius: 16, backgroundColor: colors.fill, alignItems: 'center', justifyContent: 'center', gap: 4 },
    actionText: { color: colors.onAccent, fontSize: 16, fontWeight: '800', textAlign: 'center' },
    phone: { color: colors.onAccent, fontSize: 14 },
    error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  })
}
