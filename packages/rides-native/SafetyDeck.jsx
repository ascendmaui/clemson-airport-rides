import { useEffect, useRef } from 'react'
import { Animated, Pressable, Text, View } from 'react-native'
import { SAFETY_FEATURES } from '../../shared/safetyHub.js'

export function SafetyDeck({ colors, activeId, onChange, children }) {
  const active = SAFETY_FEATURES.find((feature) => feature.id === activeId) || SAFETY_FEATURES[0]
  const fade = useRef(new Animated.Value(1)).current
  const rise = useRef(new Animated.Value(0)).current

  useEffect(() => {
    fade.setValue(0)
    rise.setValue(8)
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.spring(rise, { toValue: 0, friction: 8, tension: 80, useNativeDriver: true }),
    ]).start()
  }, [active.id, fade, rise])

  return (
    <View style={{ gap: 12 }}>
      <View
        accessibilityRole="tablist"
        style={{
          flexDirection: 'row',
          backgroundColor: colors.purpleSoft,
          borderRadius: 16,
          padding: 4,
          gap: 4,
        }}
      >
        {SAFETY_FEATURES.map((feature) => {
          const selected = feature.id === active.id
          return (
            <Pressable
              key={feature.id}
              accessibilityRole="tab"
              accessibilityLabel={feature.title}
              accessibilityState={{ selected }}
              onPress={() => onChange?.(feature.id)}
              style={{
                flex: 1,
                minHeight: 40,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: selected ? colors.orange : 'transparent',
              }}
            >
              <Text style={{
                color: selected ? colors.onAccent : colors.purple,
                fontWeight: '800',
                fontSize: 12,
              }}>
                {feature.label}
              </Text>
            </Pressable>
          )
        })}
      </View>
      <Animated.View
        accessibilityLabel={active.title}
        style={{
          opacity: fade,
          transform: [{ translateY: rise }],
          backgroundColor: colors.card,
          borderRadius: 20,
          padding: 16,
          borderWidth: 1,
          borderColor: selectedBorder(active.id, colors),
          gap: 8,
        }}
      >
        <Text style={{ color: colors.orange, fontWeight: '800', letterSpacing: 1.1, fontSize: 11 }}>
          {active.label.toUpperCase()}
        </Text>
        <Text style={{ color: colors.title, fontWeight: '800', fontSize: 20 }}>{active.title}</Text>
        <Text style={{ color: colors.inkSecondary, fontSize: 14, lineHeight: 20 }}>{active.body}</Text>
        {children}
      </Animated.View>
    </View>
  )
}

function selectedBorder(id, colors) {
  if (id === 'sos') return colors.danger || colors.orange
  if (id === 'audio' || id === 'video') return colors.orange
  return colors.border
}
