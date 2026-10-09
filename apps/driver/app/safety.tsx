import { useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AudioCaptureCard } from 'rides-native/AudioCaptureCard'
import { SafetyDeck } from 'rides-native/SafetyDeck'
import { VideoCaptureCard } from 'rides-native/VideoCaptureCard'
import { CUPD_PHONE_DISPLAY, CUPD_PHONE_E164 } from 'rides-native/safety.js'
import { SAFETY_FEATURE_IDS, driverTrackingCopy } from '../../../shared/safetyHub.js'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'

export default function DriverSafetyScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { colors } = useTheme()
  const styles = useMemo(() => makeStyles(colors), [colors])
  const [feature, setFeature] = useState<(typeof SAFETY_FEATURE_IDS)[number]>('sos')
  const [status, setStatus] = useState<string | null>(null)
  const [armed, setArmed] = useState<'911' | 'cupd' | null>(null)

  useEffect(() => {
    if (!user?.id || !supabase) return undefined
    let alive = true
    supabase
      .from('trips')
      .select('status')
      .eq('driver_id', user.id)
      .in('status', ['accepted', 'arriving', 'in_progress'])
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (alive) setStatus(data?.status || null)
      })
      .catch(() => {
        if (alive) setStatus(null)
      })
    return () => {
      alive = false
    }
  }, [user?.id])

  function call(kind: '911' | 'cupd') {
    if (armed !== kind) {
      setArmed(kind)
      return
    }
    const href = kind === '911' ? 'tel:911' : `tel:${CUPD_PHONE_E164}`
    Linking.openURL(href)
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backLabel}>←</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>SAFETY</Text>
          <Text style={styles.title}>On this ride</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.list}>
        <Text style={styles.body}>
          Audio, video, live location, and SOS are together here. Recording stays on this phone and is not uploaded.
        </Text>
        {!user ? <Text style={styles.body}>Sign in to use recording on an active ride.</Text> : null}
        <SafetyDeck colors={colors} activeId={feature} onChange={setFeature}>
          <View style={{ display: feature === 'audio' ? 'flex' : 'none' }}>
            <AudioCaptureCard status={status} colors={colors} />
          </View>
          <View style={{ display: feature === 'video' ? 'flex' : 'none' }}>
            <VideoCaptureCard status={status} colors={colors} />
          </View>
          <View style={{ display: feature === 'tracking' ? 'flex' : 'none' }}>
            <Text style={styles.body}>{driverTrackingCopy()}</Text>
          </View>
          <View style={{ display: feature === 'sos' ? 'flex' : 'none', gap: 8 }}>
            <Text style={styles.body}>
              Clemson University Police are {CUPD_PHONE_DISPLAY}. The first press confirms and does not dial.
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Call 911" onPress={() => call('911')} style={[styles.action, { backgroundColor: colors.danger }]}>
              <Text style={styles.actionText}>{armed === '911' ? 'Confirm call 911' : 'Call 911'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Call Clemson Police ${CUPD_PHONE_DISPLAY}`} onPress={() => call('cupd')} style={[styles.action, { backgroundColor: colors.purple }]}>
              <Text style={styles.actionText}>{armed === 'cupd' ? `Confirm CUPD ${CUPD_PHONE_DISPLAY}` : `Call Clemson Police ${CUPD_PHONE_DISPLAY}`}</Text>
            </Pressable>
          </View>
        </SafetyDeck>
      </ScrollView>
    </View>
  )
}

function makeStyles(colors: Palette) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
    back: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.card, alignItems: 'center' as const, justifyContent: 'center' as const },
    backLabel: { fontSize: 18, color: colors.title, fontWeight: '700' as const },
    kicker: { color: colors.orange, fontWeight: '800' as const, letterSpacing: 1.1, fontSize: 11 },
    title: { color: colors.title, fontSize: 22, fontWeight: '800' as const },
    list: { padding: 16, gap: 14, paddingBottom: 32 },
    body: { color: colors.inkSecondary, fontSize: 14, lineHeight: 20 },
    action: { minHeight: 48, borderRadius: 14, alignItems: 'center' as const, justifyContent: 'center' as const },
    actionText: { color: colors.onAccent, fontWeight: '800' },
  })
}
