import { usePathname } from 'expo-router'
import { useEffect, useRef } from 'react'
import { AccessibilityInfo, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Glyph } from 'rides-native/icons'
import { radius, shadowStyle } from 'rides-native/shared/theme.js'
import { driverActionQueue, useDriverActionQueue } from '@/lib/actionQueue'
import { showSyncBannerOn, syncBannerView } from '@/lib/syncBanner'
import { useTheme } from '@/lib/theme'
import { quiet } from '@/lib/softFail'

/** "No signal · 2 actions waiting to sync". Tap to retry now. Clears on reconnect. */
export function SyncBanner() {
  const { colors, scheme } = useTheme()
  const insets = useSafeAreaInsets()
  const pathname = usePathname()
  const state = useDriverActionQueue()
  const view = syncBannerView({ offline: state.offline, pending: state.pending })
  const announced = useRef<string | null>(null)
  useEffect(() => {
    const key = view?.title ?? null
    if (key && key !== announced.current) AccessibilityInfo.announceForAccessibility(view!.announce)
    announced.current = key
  }, [view?.title])
  if (!view || !showSyncBannerOn(pathname)) return null
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16, zIndex: 40 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={view.title}
        accessibilityHint="Tries to send your saved taps now"
        onPress={() => { void driverActionQueue()?.flush().catch(quiet('sync banner flush')) }}
        style={[{
          flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44,
          paddingVertical: 10, paddingHorizontal: 14, borderRadius: radius.lg,
          backgroundColor: colors.card, borderLeftWidth: 4, borderLeftColor: state.offline ? colors.orange : colors.purple,
        }, shadowStyle(colors.shadow, 'float', scheme)]}
      >
        <Glyph name={state.offline ? 'offline' : 'refresh'} size={20} color={state.offline ? colors.orange : colors.purple} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 14 }}>{view.title}</Text>
          <Text style={{ color: colors.inkSecondary, fontSize: 13 }}>{view.body}</Text>
        </View>
      </Pressable>
    </View>
  )
}
