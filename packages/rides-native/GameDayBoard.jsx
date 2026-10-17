import { Pressable, Text, View } from 'react-native'
import { peakSurgeView } from './peakStatus.js'

const ORANGE = '#F56600'
const PURPLE = '#522D80'
const TICKET = '#F7F4F0'
const INK = '#241833'
const MUTED = '#5C516E'

function ticketStyle(extra) {
  return {
    backgroundColor: TICKET,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(82,45,128,0.18)',
    padding: 16,
    gap: 8,
    ...extra,
  }
}

export function GameDayBanner({ model, onPress }) {
  if (!model) return null
  const { banner, surge } = model
  const label = [
    banner.kicker,
    banner.title,
    banner.countdownLabel,
    banner.countdownCaption,
    surge.headline,
  ].filter(Boolean).join('. ')
  const body = (
    <View style={ticketStyle()}>
      <Text style={{ color: PURPLE, fontSize: 11, fontWeight: '800', letterSpacing: 1.4 }}>{banner.kicker}</Text>
      <Text style={{ color: INK, fontSize: 20, fontWeight: '800' }}>{banner.title}</Text>
      {banner.countdownLabel ? (
        <Text style={{ color: ORANGE, fontSize: 40, fontWeight: '700', letterSpacing: -1 }}>{banner.countdownLabel}</Text>
      ) : null}
      <Text style={{ color: MUTED, fontSize: 14, lineHeight: 20 }}>{banner.countdownCaption}</Text>
      {banner.kickoffLabel ? <Text style={{ color: PURPLE, fontSize: 13, fontWeight: '700' }}>{banner.kickoffLabel}</Text> : null}
      <Text style={{ color: ORANGE, fontSize: 15, fontWeight: '800' }}>{surge.headline}</Text>
    </View>
  )
  if (!onPress) {
    return <View accessibilityRole="text" accessibilityLabel={label}>{body}</View>
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint="Opens the stadium guide" onPress={onPress}>
      {body}
    </Pressable>
  )
}

export function GameDaySurgeLine({ model, online = false, onPress, peak = null, colors = null }) {
  const peakView = peakSurgeView(peak, online)
  if (!model && !peakView) return null
  const surge = peakView
    ? { multiplierLabel: peakView.multiplierLabel, headline: peakView.headline, driverLine: peakView.line }
    : model.surge
  const line = online ? surge.headline : surge.driverLine
  const label = `${line}. ${surge.multiplierLabel}.`
  const plate = colors?.card || TICKET
  const kicker = colors?.link || PURPLE
  const amount = colors?.orange || ORANGE
  const ink = colors?.title || INK
  const muted = colors?.inkSecondary || MUTED
  const border = colors?.border || 'rgba(82,45,128,0.18)'
  const body = (
    <View style={ticketStyle({ paddingVertical: 12, paddingHorizontal: 14, backgroundColor: plate, borderColor: border })}>
      <Text style={{ color: kicker, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 }}>
        {online ? 'RIDER FARE' : 'BEFORE YOU GO ONLINE'}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <Text style={{ color: amount, fontSize: 28, fontWeight: '700', letterSpacing: -0.6 }}>{surge.multiplierLabel}</Text>
        <Text style={{ color: ink, fontSize: 13, fontWeight: '700', flex: 1 }}>{surge.headline}</Text>
      </View>
      <Text style={{ color: muted, fontSize: 13, lineHeight: 18 }}>{line}</Text>
    </View>
  )
  if (!onPress) return <View accessibilityRole="text" accessibilityLabel={label}>{body}</View>
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint="Opens game-day prep and hot times" onPress={onPress}>
      {body}
    </Pressable>
  )
}

function ZoneList({ title, rows, tone }) {
  if (!rows.length) return null
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: PURPLE, fontSize: 12, fontWeight: '800', letterSpacing: 1 }}>{title}</Text>
      {rows.map((zone) => (
        <View key={zone.id} style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ width: 3, borderRadius: 2, backgroundColor: tone }} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: INK, fontSize: 16, fontWeight: '800' }}>{zone.name}</Text>
            {zone.walkMinutes != null ? (
              <Text style={{ color: ORANGE, fontSize: 12, fontWeight: '700' }}>{zone.walkMinutes} min walk</Text>
            ) : null}
            <Text style={{ color: MUTED, fontSize: 13, lineHeight: 18 }}>{zone.instructions}</Text>
          </View>
        </View>
      ))}
    </View>
  )
}

export function GameDayBoard({ model, audience = 'rider', onTogglePrep }) {
  if (!model) return null
  const rider = audience === 'rider'
  return (
    <View style={{ gap: 12 }}>
      <GameDayBanner model={model} />
      {rider ? (
        <View style={ticketStyle({ gap: 14 })} accessibilityRole="text" accessibilityLabel={`${model.zones.headline}. ${model.zones.body}`}>
          <Text style={{ color: INK, fontSize: 18, fontWeight: '800' }}>{model.zones.headline}</Text>
          <Text style={{ color: MUTED, fontSize: 13, lineHeight: 18 }}>{model.zones.body}</Text>
          <ZoneList title="PICKUP" rows={model.zones.pickups} tone={ORANGE} />
          <ZoneList title="DROP-OFF" rows={model.zones.dropoffs} tone={PURPLE} />
        </View>
      ) : null}
      {rider && model.queue.visible ? (
        <View style={ticketStyle()} accessibilityRole="text" accessibilityLabel={`${model.queue.headline}. ${model.queue.detail}`}>
          <Text style={{ color: PURPLE, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 }}>PICKUP QUEUE</Text>
          <Text style={{ color: INK, fontSize: 18, fontWeight: '800' }}>{model.queue.headline}</Text>
          {model.queue.waitLabel ? (
            <Text style={{ color: ORANGE, fontSize: 32, fontWeight: '700' }}>{model.queue.waitLabel}</Text>
          ) : null}
          <Text style={{ color: MUTED, fontSize: 14, lineHeight: 20 }}>{model.queue.detail}</Text>
        </View>
      ) : null}
      {!rider ? (
        <View style={ticketStyle({ gap: 10 })}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <Text style={{ color: INK, fontSize: 18, fontWeight: '800' }}>{model.prep.headline}</Text>
            <Text style={{ color: ORANGE, fontSize: 13, fontWeight: '800' }}>{model.prep.progressLabel}</Text>
          </View>
          {model.prep.items.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="checkbox"
              accessibilityLabel={`${item.title}. ${item.detail}`}
              accessibilityState={{ checked: item.checked }}
              onPress={() => onTogglePrep?.(item.id)}
              style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}
            >
              <View style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                borderWidth: 2,
                borderColor: item.checked ? ORANGE : PURPLE,
                backgroundColor: item.checked ? ORANGE : 'transparent',
                marginTop: 2,
              }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: INK, fontSize: 15, fontWeight: '800' }}>{item.title}</Text>
                <Text style={{ color: MUTED, fontSize: 13, lineHeight: 18 }}>{item.detail}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
      {!rider ? (
        <View style={ticketStyle({ gap: 12 })}>
          <Text style={{ color: INK, fontSize: 18, fontWeight: '800' }}>{model.timeline.headline}</Text>
          <Text style={{ color: MUTED, fontSize: 13, lineHeight: 18 }}>{model.timeline.body}</Text>
          {model.timeline.windows.map((window) => (
            <View key={window.id} style={{ flexDirection: 'row', gap: 10, opacity: window.state === 'past' ? 0.45 : 1 }}>
              <View style={{ width: 10, alignItems: 'center' }}>
                <View style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: window.state === 'now' || window.heat === 'peak' ? ORANGE : PURPLE,
                }} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: INK, fontSize: 15, fontWeight: '800' }}>{window.label}</Text>
                <Text style={{ color: ORANGE, fontSize: 12, fontWeight: '700' }}>{window.whenLabel} · {window.heatLabel}</Text>
                <Text style={{ color: MUTED, fontSize: 13, lineHeight: 18 }}>{window.note}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
      <View style={ticketStyle()} accessibilityRole="text" accessibilityLabel={`${model.surge.headline}. ${rider ? model.surge.riderLine : model.surge.driverLine}`}>
        <Text style={{ color: PURPLE, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 }}>FARE</Text>
        <Text style={{ color: ORANGE, fontSize: 36, fontWeight: '700', letterSpacing: -0.8 }}>{model.surge.multiplierLabel}</Text>
        <Text style={{ color: INK, fontSize: 16, fontWeight: '800' }}>{model.surge.headline}</Text>
        <Text style={{ color: MUTED, fontSize: 14, lineHeight: 20 }}>{rider ? model.surge.riderLine : model.surge.driverLine}</Text>
        {model.surge.reasons.map((reason) => (
          <Text key={reason} style={{ color: INK, fontSize: 13, lineHeight: 18 }}>{reason}</Text>
        ))}
      </View>
    </View>
  )
}
