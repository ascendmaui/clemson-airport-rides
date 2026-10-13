import { useState } from 'react'
import { Text, View } from 'react-native'
import { InfoButton, InfoSheet } from './InfoSheet.jsx'
import {
  PAY_TIERS,
  WORTH_IT_GAUGE_BODY,
  WORTH_IT_LEGEND_LABEL,
  WORTH_IT_LEGEND_TITLE,
  worthItTierForHourlyCents,
} from '../../shared/worthItGauge.js'

const ORANGE = '#F56600'

export function WorthItLegend({ hourlyCents, colors }) {
  const tone = colors || {}
  const tier = worthItTierForHourlyCents(hourlyCents)
  const [open, setOpen] = useState(false)
  const ink = tone.ink || '#241c33'
  const muted = tone.inkSecondary || '#5c5468'
  return (
    <View style={{ gap: 6, marginTop: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={{ color: tone.orange || ORANGE, fontWeight: '800', fontSize: 11, letterSpacing: 0.6 }}>WORTH-IT</Text>
          <View
            accessibilityRole="summary"
            accessibilityLabel={tier ? `${tier.label}. ${tier.range} per hour. ${tier.note}.` : WORTH_IT_LEGEND_LABEL}
            style={{ flexDirection: 'row', gap: 3, height: 10 }}
          >
            {PAY_TIERS.map((row) => {
              const current = Boolean(tier && row.id === tier.id)
              return (
                <View
                  key={row.id}
                  style={{
                    flex: current ? 1.7 : 1,
                    borderRadius: 5,
                    backgroundColor: row.color,
                    opacity: !tier || current ? 1 : 0.45,
                  }}
                />
              )
            })}
          </View>
        </View>
        <InfoButton label={WORTH_IT_LEGEND_LABEL} onPress={() => setOpen(true)} colors={colors} />
      </View>
      {tier ? <Text style={{ color: ink, fontWeight: '800' }}>{tier.label} · {tier.note}</Text> : null}
      {tier ? <Text style={{ color: muted, fontSize: 13 }}>{tier.range} per hour</Text> : null}
      <InfoSheet
        open={open}
        onClose={() => setOpen(false)}
        colors={colors}
        title={WORTH_IT_LEGEND_TITLE}
        closeLabel="Close worth-it gauge tiers"
      >
        <Text style={{ color: ink, fontSize: 15, lineHeight: 21, marginTop: 8 }}>{WORTH_IT_GAUGE_BODY}</Text>
        <View style={{ gap: 10, marginTop: 14 }}>
          {PAY_TIERS.map((row) => {
            const current = Boolean(tier && row.id === tier.id)
            return (
              <View
                key={row.id}
                accessibilityLabel={`${row.label}, ${row.range}, ${row.note}${current ? ', this offer' : ''}`}
                style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}
              >
                <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: row.color, marginTop: 3 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: ink, fontWeight: '800' }}>{row.label} · {row.range}</Text>
                  <Text style={{ color: muted, fontSize: 13, lineHeight: 18 }}>
                    {row.note}{current ? ' · This offer' : ''}
                  </Text>
                </View>
              </View>
            )
          })}
        </View>
      </InfoSheet>
    </View>
  )
}
