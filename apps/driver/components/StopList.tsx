import { Text, View } from 'react-native'
import { Card, Primary } from '@/components/chrome'
import { useTheme } from '@/lib/theme'
import {
  fareCaptureLine,
  nextStopIndex,
  stopActionLabel,
  stopNextOp,
  stopStatusLabel,
  stopTitle,
  type StopOp,
  type TripStop,
} from 'rides-native/carpoolStops'

/**
 * Carpool ordered stops: pickup A, pickup B, then drop-offs. Only the current
 * stop has an action. Drop-offs list the fare recorded for each rider.
 */
export function StopList({ stops, busy, onAction }: {
  stops: TripStop[]
  busy: boolean
  onAction: (stop: TripStop, op: StopOp) => void
}) {
  const { colors } = useTheme()
  const current = nextStopIndex(stops)
  return (
    <Card>
      <Text accessibilityRole="header" style={{ color: colors.title, fontWeight: '900', fontSize: 18 }}>
        Carpool stops · {stops.length}
      </Text>
      {stops.map((stop) => {
        const active = stop.index === current
        const op = active ? stopNextOp(stop) : null
        const label = active ? stopActionLabel(stop) : null
        const riderName = (id: string) => stop.riders.find((r) => r.id === id)?.name || 'Rider'
        return (
          <View
            key={`${stop.index}-${stop.kind}`}
            accessible={!active}
            accessibilityLabel={`Stop ${stop.index + 1}. ${stopTitle(stop)} at ${stop.label}. ${stopStatusLabel(stop)}.`}
            style={{
              gap: 4,
              paddingVertical: 8,
              borderTopWidth: stop.index === 0 ? 0 : 1,
              borderColor: colors.border,
              opacity: stop.status === 'done' ? 0.6 : 1,
            }}
          >
            <Text style={{ color: active ? colors.orange : colors.inkSecondary, fontWeight: '800', fontSize: 12, letterSpacing: 1 }}>
              {`${stop.index + 1} · ${stop.kind === 'pickup' ? 'PICKUP' : 'DROP-OFF'} · ${stopStatusLabel(stop).toUpperCase()}`}
            </Text>
            <Text style={{ color: colors.title, fontWeight: '800', fontSize: 16 }}>{stopTitle(stop)}</Text>
            <Text style={{ color: colors.inkSecondary }}>{stop.label}</Text>
            {stop.fares.map((fare) => (
              <Text key={fare.participantId} style={{ color: colors.ink, fontWeight: '700' }}>
                {fareCaptureLine(fare, riderName(fare.participantId))}
              </Text>
            ))}
            {op && label ? (
              <Primary
                label={busy ? 'Updating…' : label}
                accessibilityLabel={`${label}, stop ${stop.index + 1}`}
                onPress={() => onAction(stop, op)}
                disabled={busy}
                tone={op === 'drop' ? 'orange' : 'purple'}
              />
            ) : null}
          </View>
        )
      })}
    </Card>
  )
}
