import { useEffect, useRef, useState } from 'react'
import { Animated, Easing, Text, View } from 'react-native'
import { searchingDemoPair, type PickupLike, type SearchingDemoCard } from 'rides-native/searchPreview.js'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'

const TICK_MS = 200

function OptionRow({
  card,
  prominent,
  colors,
}: {
  card: SearchingDemoCard
  prominent: boolean
  colors: Palette
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: prominent ? 8 : 4,
        paddingHorizontal: 10,
        borderRadius: 14,
        backgroundColor: prominent ? colors.purpleSoft : 'transparent',
      }}
    >
      <View
        style={{
          width: prominent ? 40 : 32,
          height: prominent ? 40 : 32,
          borderRadius: 20,
          backgroundColor: card.paint.fill,
          borderWidth: 2,
          borderColor: card.paint.edge,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: card.paint.ink, fontWeight: '800', fontSize: prominent ? 16 : 13 }}>{card.initials}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: colors.title, fontWeight: '700', fontSize: prominent ? 16 : 14 }}>{card.firstName}</Text>
        <Text style={{ color: colors.inkSecondary, fontSize: 13, lineHeight: 18 }}>{card.vehicleLabel}</Text>
      </View>
      <Text style={{ color: prominent ? colors.orange : colors.purple, fontWeight: '800', fontSize: 12 }}>{card.previewRank}</Text>
    </View>
  )
}

/** Names on the searching card, ordered by preview rank. Not a request control. */
export function SearchDemoCycle({ pickup = null }: { pickup?: PickupLike }) {
  const { colors } = useTheme()
  const started = useRef(Date.now())
  const [elapsed, setElapsed] = useState(0)
  const opacity = useRef(new Animated.Value(0)).current
  const rise = useRef(new Animated.Value(8)).current

  useEffect(() => {
    started.current = Date.now()
    const id = setInterval(() => setElapsed(Date.now() - started.current), TICK_MS)
    return () => clearInterval(id)
  }, [])

  const pair = searchingDemoPair(elapsed, Date.now(), pickup)
  const spoken = `${pair.current.firstName}, ${pair.current.vehicleLabel}. ${pair.next.firstName}, ${pair.next.vehicleLabel}.`

  useEffect(() => {
    opacity.setValue(0)
    rise.setValue(8)
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 460,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(rise, {
        toValue: 0,
        duration: 460,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start()
  }, [pair.current.id, opacity, rise])

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      accessibilityLabel={spoken}
      style={{ opacity, transform: [{ translateY: rise }], gap: 4 }}
    >
      <OptionRow card={pair.current} prominent colors={colors} />
      <OptionRow card={pair.next} prominent={false} colors={colors} />
    </Animated.View>
  )
}
