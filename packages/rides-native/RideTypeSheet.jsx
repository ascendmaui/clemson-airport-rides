import { useState } from 'react'
import { Text, View } from 'react-native'
import { InfoButton, InfoSheet } from './InfoSheet.jsx'
import { RIDE_TYPE_GUIDE, RIDE_TYPE_PURPLE } from '../../shared/copy/rideTypes.js'

const ORANGE = '#F56600'

export function RideTypeInfoButton({ colors, selectedId }) {
  const tone = colors || {}
  const [open, setOpen] = useState(false)
  const ink = tone.ink || '#241c33'
  const muted = tone.inkSecondary || '#5c5468'
  const selected = String(selectedId || '')
  return (
    <>
      <InfoButton label={RIDE_TYPE_GUIDE.infoLabel} onPress={() => setOpen(true)} colors={colors} />
      <InfoSheet
        open={open}
        onClose={() => setOpen(false)}
        colors={colors}
        title={RIDE_TYPE_GUIDE.title}
        closeLabel="Close ride types"
      >
        <Text style={{ color: muted, fontSize: 14, lineHeight: 20, marginTop: 8 }}>{RIDE_TYPE_GUIDE.lede}</Text>
        <View style={{ gap: 8, marginTop: 12 }}>
          {RIDE_TYPE_GUIDE.types.map((row) => {
            const on = row.id === selected
            return (
              <View
                key={row.id}
                accessibilityLabel={`${row.name}. ${row.detail}${on ? ' Selected.' : ''}`}
                style={{
                  flexDirection: 'row',
                  gap: 10,
                  padding: 10,
                  borderRadius: 14,
                  borderWidth: on ? 2 : 1,
                  borderColor: on ? (tone.orange || ORANGE) : (tone.border || 'rgba(82,45,128,0.18)'),
                  backgroundColor: on ? (tone.orangeSoft || 'rgba(245,102,0,0.12)') : 'transparent',
                }}
              >
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: row.color, marginTop: 4 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: ink, fontWeight: '800' }}>{row.name}{on ? ' · Selected' : ''}</Text>
                  <Text style={{ color: muted, fontSize: 14, lineHeight: 20 }}>{row.detail}</Text>
                </View>
              </View>
            )
          })}
        </View>
        <Text style={{ color: tone.purple || RIDE_TYPE_PURPLE, fontWeight: '800', marginTop: 14 }}>{RIDE_TYPE_GUIDE.studentTitle}</Text>
        <Text style={{ color: ink, fontSize: 14, lineHeight: 20, marginTop: 4 }}>{RIDE_TYPE_GUIDE.studentNote}</Text>
      </InfoSheet>
    </>
  )
}
