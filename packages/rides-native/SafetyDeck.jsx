import { useEffect, useRef } from 'react'
import { Animated, Pressable, Text, View } from 'react-native'
import { SAFETY_FEATURES } from '../../shared/safetyHub.js'
import { useReduceMotion } from './shared/reduceMotion.js'
import { radius, type as typeScale } from './shared/theme.js'

export function SafetyDeck({ colors, activeId, onChange, children, description }) {
  const active = SAFETY_FEATURES.find((feature) => feature.id === activeId) || SAFETY_FEATURES[0]
  const reduceMotion = useReduceMotion()
  const rise = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (reduceMotion) {
      rise.setValue(0)
      return undefined
    }
    rise.setValue(8)
    const anim = Animated.spring(rise, { toValue: 0, friction: 8, tension: 80, useNativeDriver: true })
    anim.start()
    return () => anim.stop()
  }, [active.id, reduceMotion, rise])

  return (
    <View style={{ gap: 12 }}>
      <View
        accessibilityRole="tablist"
        style={{
          flexDirection: 'row',
          backgroundColor: colors.purpleSoft,
          borderRadius: radius.lg,
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
                borderRadius: radius.sm,
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
          transform: [{ translateY: rise }],
          backgroundColor: colors.card,
          borderRadius: radius.panel,
          padding: 16,
          borderWidth: 1,
          borderColor: selectedBorder(active.id, colors),
          gap: 8,
        }}
      >
        <Text style={{ color: colors.orange, ...typeScale.kickerSm }}>
          {active.label.toUpperCase()}
        </Text>
        <Text style={{ color: colors.title, fontWeight: '800', fontSize: 20, letterSpacing: -0.3 }}>{active.title}</Text>
        <Text style={{ color: colors.inkSecondary, ...typeScale.body }}>{description || active.body}</Text>
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
