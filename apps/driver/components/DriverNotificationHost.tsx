import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Animated, AppState, Easing, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuth } from '@/lib/auth'
import {
  isRideOfferNotice,
  loadNewDriverNotifications,
  markDriverNotificationRead,
  noticeDedupeKey,
  refreshUnreadCount,
  subscribeDriverNotificationInserts,
  tripIdOf,
  type DriverNotice,
} from '@/lib/driverNotifications'
import { subscribeForegroundPushes, type ForegroundPush } from '@/lib/push'
import { supabase } from '@/lib/supabase'
import { color, shadowStyle } from 'rides-native/shared/theme.js'
import { useTheme } from '@/lib/theme'

const HIDDEN_Y = -180
const POLL_MS = 15000

function pushToNotice(push: ForegroundPush): DriverNotice {
  const data = push.data || {}
  const id = typeof data.notificationId === 'string' ? data.notificationId : ''
  const kind = typeof data.kind === 'string' ? data.kind : ''
  return {
    id,
    type: kind === 'ride_offer' ? 'ride_offer' : kind,
    title: push.title || 'Clemson Rides',
    body: push.body || '',
    data,
    read_at: null,
    created_at: new Date().toISOString(),
  }
}

/**
 * In-app Clemson Rides card while the Driver app is in the foreground.
 * Remote pushes arrive through the expo-notifications foreground handler.
 * Rows inserted on the server also arrive through Supabase realtime, with a
 * poll behind it when realtime is not enabled for driver_notifications.
 */
export function DriverNotificationHost() {
  const { user } = useAuth()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { colors, scheme } = useTheme()
  const [notice, setNotice] = useState<DriverNotice | null>(null)
  const seen = useRef(new Set<string>())
  const cursor = useRef(new Date().toISOString())
  const translateY = useRef(new Animated.Value(HIDDEN_Y)).current
  const reduceMotion = useRef(false)

  function show(next: DriverNotice) {
    if (AppState.currentState !== 'active') return
    const key = noticeDedupeKey(next)
    if (seen.current.has(key)) return
    seen.current.add(key)
    if (next.created_at && next.created_at > cursor.current) cursor.current = next.created_at
    setNotice(next)
  }

  useEffect(() => {
    let alive = true
    AccessibilityInfo.isReduceMotionEnabled?.().then((value) => {
      if (alive) reduceMotion.current = Boolean(value)
    }).catch(() => {
      if (alive) reduceMotion.current = false
    })
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (value: boolean) => {
      reduceMotion.current = Boolean(value)
    })
    return () => {
      alive = false
      sub?.remove?.()
    }
  }, [])

  useEffect(() => {
    if (!notice) return undefined
    translateY.setValue(reduceMotion.current ? 0 : HIDDEN_Y)
    Animated.timing(translateY, {
      toValue: 0,
      duration: reduceMotion.current ? 0 : 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start()
    const text = notice.body ? `${notice.title}. ${notice.body}` : notice.title
    AccessibilityInfo.announceForAccessibility?.(text)
    const timer = setTimeout(() => setNotice(null), isRideOfferNotice(notice) ? 7000 : 4500)
    return () => clearTimeout(timer)
  }, [notice, translateY])

  useEffect(() => {
    const stop = subscribeForegroundPushes((push) => {
      if (!push.title && !push.body) return
      show(pushToNotice(push))
    })
    return stop
  }, [])

  useEffect(() => {
    if (!user?.id || !supabase) {
      return undefined
    }
    const client = supabase
    const userId = user.id
    let alive = true
    refreshUnreadCount(client, userId).catch(() => undefined)
    const unsubscribe = subscribeDriverNotificationInserts(client, userId, (row) => {
      if (!alive) return
      show(row)
      refreshUnreadCount(client, userId).catch(() => undefined)
    })
    const poll = setInterval(() => {
      if (AppState.currentState !== 'active') return
      loadNewDriverNotifications(client, userId, cursor.current).then((rows) => {
        if (!alive) return
        for (const row of rows) show(row)
        if (rows.length) refreshUnreadCount(client, userId).catch(() => undefined)
      }).catch(() => undefined)
    }, POLL_MS)
    return () => {
      alive = false
      unsubscribe()
      clearInterval(poll)
    }
  }, [user?.id])

  if (!notice) return null
  const offer = isRideOfferNotice(notice)
  const tripId = tripIdOf(notice)
  const shadow = shadowStyle(color.shadow, 'float', scheme)

  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + 8 }]}>
      <Animated.View style={{ transform: [{ translateY }] }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={notice.body ? `${notice.title}. ${notice.body}` : notice.title}
          accessibilityHint={offer ? 'Opens the ride offer' : 'Dismisses this notification'}
          onPress={() => {
            setNotice(null)
            if (user?.id && supabase && notice.id) {
              markDriverNotificationRead(supabase, user.id, notice.id).catch(() => undefined)
            }
            if (offer && tripId) router.push({ pathname: '/', params: { offer: tripId } })
          }}
          style={[styles.card, shadow, { backgroundColor: colors.card, borderLeftColor: colors.orange }]}
        >
          <Text style={[styles.kicker, { color: colors.link }]}>Clemson Rides</Text>
          <Text style={[styles.title, { color: colors.title }]}>{notice.title}</Text>
          {notice.body ? <Text style={[styles.body, { color: colors.ink }]}>{notice.body}</Text> : null}
          {offer ? <Text style={[styles.action, { color: colors.orange }]}>Open offer</Text> : null}
        </Pressable>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 16, right: 16, zIndex: 40 },
  card: {
    borderRadius: 18,
    borderLeftWidth: 5,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 4,
  },
  kicker: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  title: { fontSize: 17, fontWeight: '800', letterSpacing: -0.2 },
  body: { fontSize: 14, lineHeight: 20 },
  action: { marginTop: 4, fontSize: 14, fontWeight: '800' },
})
