import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Glyph } from 'rides-native/icons'
import { radius, shadowStyle } from 'rides-native/shared/theme.js'
import { watchNetInfo } from '@/lib/netInfoWatch'
import { offlineBannerView } from '@/lib/offlineBanner'
import { readOffline, reportNetwork, subscribeNetwork } from '@/lib/reconnectRetry'
import { useTheme } from '@/lib/theme'

function useOffline(): boolean {
  const [offline, setOffline] = useState(readOffline)
  useEffect(() => subscribeNetwork(() => setOffline(readOffline())), [])
  return offline
}

/** Starts the NetInfo listener. Mounted for the whole app life, including boot. */
export function NetworkWatch() {
  useEffect(() => watchNetInfo(reportNetwork), [])
  return null
}

/** Brand banner. Paints on the NetInfo callback, inside the 2s budget. */
export function OfflineBanner() {
  const { colors, scheme } = useTheme()
  const insets = useSafeAreaInsets()
  const offline = useOffline()
  const view = offlineBannerView(offline)
  const announced = useRef<string | null>(null)
  useEffect(() => {
    const key = view?.announce ?? null
    if (key && key !== announced.current) AccessibilityInfo.announceForAccessibility(key)
    announced.current = key
  }, [view?.announce])
  if (!view) return null
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, zIndex: 80 }}>
      <View
        accessibilityRole="alert"
        accessibilityLabel={view.announce}
        style={[{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          minHeight: 44,
          paddingVertical: 10,
          paddingHorizontal: 14,
          borderRadius: radius.lg,
          backgroundColor: colors.card,
          borderLeftWidth: 4,
          borderLeftColor: colors.orange,
        }, shadowStyle(colors.shadow, 'float', scheme)]}
      >
        <Glyph name="offline" size={20} color={colors.orange} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 14 }}>{view.title}</Text>
          <Text style={{ color: colors.inkSecondary, fontSize: 13 }}>{view.body}</Text>
        </View>
      </View>
    </View>
  )
}
