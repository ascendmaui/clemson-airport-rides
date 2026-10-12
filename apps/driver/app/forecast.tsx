import { useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { Card, ErrorText, Tag } from '@/components/chrome'
import { SectionLabel, StackPage } from '@/components/shell'
import { dollarsPerHour, loadForecast, type Forecast, type ForecastSlot } from '@/lib/forecast'
import { useTheme } from '@/lib/theme'
import { formatSlotWindow } from 'rides-native/earningsForecast.js'

function SlotRow({ slot }: { slot: ForecastSlot }) {
  const { colors } = useTheme()
  return (
    <View
      accessible
      accessibilityLabel={`${formatSlotWindow(slot)}, ${slot.zoneLabel}, about ${dollarsPerHour(slot.expectedCentsPerHour)}, ${slot.confidence} confidence`}
      style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 2 }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.title, fontWeight: '800' }}>{formatSlotWindow(slot)}</Text>
        <Text style={{ color: colors.orange, fontWeight: '800' }}>~{dollarsPerHour(slot.expectedCentsPerHour)}</Text>
      </View>
      <Text style={{ color: colors.ink }}>{slot.zoneLabel} · {slot.confidence} confidence</Text>
      <Text style={{ color: colors.inkSecondary, fontSize: 12 }}>{slot.reasons.join(' · ')}</Text>
    </View>
  )
}

export default function ForecastScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const [data, setData] = useState<Forecast | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback((force: boolean) => {
    loadForecast(force)
      .then((next) => { setData(next); setError(null) })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load the forecast.'))
  }, [])
  useEffect(() => { load(false) }, [load])

  return (
    <StackPage title="Earnings forecast" onBack={() => router.back()}>
      <Card>
        <Tag label="Estimate" tone="orange" />
        <Text style={{ color: colors.ink, lineHeight: 20 }}>
          {data?.disclaimer || 'Estimate only. Not a guarantee of rides or pay.'}
        </Text>
        {data?.eventsNote ? <Text style={{ color: colors.inkSecondary }}>{data.eventsNote}</Text> : null}
      </Card>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {!data && !error ? <Text style={{ color: colors.inkSecondary }}>Loading…</Text> : null}
      {data ? (
        <>
          <SectionLabel>Top windows · next 7 days</SectionLabel>
          <Card>{data.top.map((slot) => <SlotRow key={`${slot.zone}-${slot.startsAt}`} slot={slot} />)}</Card>
          <SectionLabel>Best window each day</SectionLabel>
          <Card>{data.bestByDay.map((slot) => <SlotRow key={`d-${slot.localDate}`} slot={slot} />)}</Card>
          {data.events.length ? (
            <>
              <SectionLabel>Events in the forecast</SectionLabel>
              <Card>
                {data.events.map((event) => (
                  <Text key={`${event.event_date}-${event.title}`} style={{ color: colors.ink }}>
                    {event.event_date} · {event.title}{event.starts_at ? '' : ' (time TBA)'}
                  </Text>
                ))}
              </Card>
            </>
          ) : null}
          <Text style={{ color: colors.inkSecondary, fontSize: 12 }}>
            Ranked by expected $/hr after ~15 min of unpaid time per trip. {data.tripsUsed} past trips used.
          </Text>
        </>
      ) : null}
    </StackPage>
  )
}
