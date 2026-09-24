import { Text, View } from 'react-native'

export function LivePhase({
  kicker,
  title,
  body,
  eta,
  steps,
  activeIndex,
  colors,
}) {
  const track = colors?.track || 'rgba(82,45,128,0.14)'
  return (
    <View style={{ gap: 6 }}>
      {kicker ? (
        <Text style={{ color: colors.orange, fontWeight: '800', letterSpacing: 1.1, fontSize: 11 }}>{kicker}</Text>
      ) : null}
      {title ? (
        <Text style={{ color: colors.title, fontSize: 22, fontWeight: '800', letterSpacing: -0.3 }}>{title}</Text>
      ) : null}
      {body ? (
        <Text style={{ color: colors.inkSecondary, fontSize: 14, lineHeight: 20 }}>{body}</Text>
      ) : null}
      {eta ? (
        <Text style={{ color: colors.purple, fontWeight: '800', fontSize: 14 }}>{eta}</Text>
      ) : null}
      {activeIndex >= 0 && steps?.length ? (
        <View accessibilityLabel="Trip progress" style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
          {steps.map((step, index) => {
            const on = index <= activeIndex
            const current = index === activeIndex
            return (
              <View key={step.id} style={{ flex: 1, gap: 4 }}>
                <View
                  style={{
                    height: 6,
                    borderRadius: 999,
                    backgroundColor: current ? colors.orange : on ? colors.purple : track,
                  }}
                />
                <Text
                  numberOfLines={1}
                  style={{
                    fontSize: 10,
                    fontWeight: '700',
                    color: current ? colors.orange : on ? colors.purple : colors.inkSecondary,
                  }}
                >
                  {step.label}
                </Text>
              </View>
            )
          })}
        </View>
      ) : null}
    </View>
  )
}
