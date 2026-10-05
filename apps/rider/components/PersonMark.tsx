import { Image, Text, View } from 'react-native'
import { portraitKind } from 'rides-native/simulatedDrivers.js'
import { DEMO_HEADSHOTS } from '@/lib/demoHeadshots'

export function PersonMark({
  id,
  name,
  avatarUrl,
  isDemo = false,
  headshotId = null,
  size = 36,
}: {
  id?: string | null
  name?: string | null
  avatarUrl?: string | null
  isDemo?: boolean
  headshotId?: string | null
  size?: number
}) {
  const portrait = portraitKind({ id, name, avatarUrl, is_demo: isDemo, headshotId })
  const radius = size / 2
  if (portrait.kind === 'demo' && portrait.headshotId && DEMO_HEADSHOTS[portrait.headshotId]) {
    const shot = size > 64 ? DEMO_HEADSHOTS[portrait.headshotId].card : DEMO_HEADSHOTS[portrait.headshotId].marker
    return <Image source={shot} accessibilityIgnoresInvertColors accessibilityRole="image" accessibilityLabel={name || 'Demo driver'} style={{ width: size, height: size, borderRadius: radius }} />
  }
  if (portrait.kind === 'photo' && avatarUrl) {
    return <Image source={{ uri: avatarUrl }} accessibilityIgnoresInvertColors accessibilityRole="image" accessibilityLabel={name || 'Driver photo'} style={{ width: size, height: size, borderRadius: radius }} />
  }
  return (
    <View accessibilityRole="image" accessibilityLabel={name ? `${name} initials` : 'Driver initials'} style={{ width: size, height: size, borderRadius: radius, backgroundColor: portrait.color || '#F56600', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: Math.max(12, size * 0.4) }}>{portrait.letter}</Text>
    </View>
  )
}
