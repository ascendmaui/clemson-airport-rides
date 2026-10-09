import { Text, View } from 'react-native'

function stepRows(steps) {
  const rows = []
  for (let index = 0; index < steps.length; index += 3) rows.push(steps.slice(index, index + 3))
  return rows
}

function StepBar({ step, index, activeIndex, colors, track, readable }) {
  const on = index <= activeIndex
  const current = index === activeIndex
  return (
    <View style={{ flex: 1, gap: 4, ...(readable ? { minWidth: 0 } : null) }}>
      <View
        style={{
          height: 4,
          borderRadius: 999,
          backgroundColor: current ? colors.orange : on ? colors.purple : track,
        }}
      />
      <Text
        {...(readable ? {} : { numberOfLines: 1 })}
        style={{
          fontSize: readable ? 12 : 11,
          lineHeight: readable ? 16 : undefined,
          fontWeight: '700',
          textAlign: 'center',
          color: current ? colors.orange : on ? colors.purple : colors.inkSecondary,
        }}
      >
        {step.label}
      </Text>
    </View>
  )
}

export function LivePhase({
  kicker,
  title,
  body,
  eta,
  steps,
  activeIndex,
  colors,
  children = null,
  readableSteps = false,
}) {
  const track = colors?.track || 'rgba(82,45,128,0.14)'
  const showSteps = activeIndex >= 0 && steps?.length
  return (
    <View style={{ gap: 8 }}>
      {kicker ? (
        <Text style={{ color: colors.orange, fontWeight: '800', letterSpacing: 1.1, fontSize: 11 }}>{kicker}</Text>
      ) : null}
      {title ? (
        <Text style={{ color: colors.title, fontSize: 22, fontWeight: '800', letterSpacing: -0.3 }}>{title}</Text>
      ) : null}
      {body ? (
        <Text style={{ color: colors.inkSecondary, fontSize: 14, lineHeight: 20 }}>{body}</Text>
      ) : null}
      {children}
      {eta ? (
        <Text style={{ color: colors.purple, fontWeight: '800', fontSize: 14 }}>{eta}</Text>
      ) : null}
      {showSteps && readableSteps ? (
        <View accessibilityLabel="Trip progress" style={{ gap: 10, marginTop: 6 }}>
          {stepRows(steps).map((row, rowIndex) => (
            <View key={row[0]?.id || rowIndex} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              {row.map((step, column) => (
                <StepBar
                  key={step.id}
                  step={step}
                  index={rowIndex * 3 + column}
                  activeIndex={activeIndex}
                  colors={colors}
                  track={track}
                  readable
                />
              ))}
            </View>
          ))}
        </View>
      ) : null}
      {showSteps && !readableSteps ? (
        <View accessibilityLabel="Trip progress" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 6 }}>
          {steps.map((step, index) => (
            <StepBar
              key={step.id}
              step={step}
              index={index}
              activeIndex={activeIndex}
              colors={colors}
              track={track}
              readable={false}
            />
          ))}
        </View>
      ) : null}
    </View>
  )
}
