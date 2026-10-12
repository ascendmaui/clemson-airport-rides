import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Card } from '@/components/chrome'
import { useTheme } from '@/lib/theme'
import { supabase } from '@/lib/supabase'
import { loadCampusEvents, type CampusEventCard } from 'rides-native/campusEvents'

/** Discover: upcoming Clemson calendar events that move rider demand. */
export function CampusEventsCard() {
  const { colors } = useTheme()
  const [events, setEvents] = useState<CampusEventCard[] | null>(null)
  const [bonus, setBonus] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    loadCampusEvents(supabase).then((out) => {
      if (!alive) return
      setEvents(out.events.slice(0, 4))
      setBonus(out.bonus?.line || null)
    })
    return () => { alive = false }
  }, [])
  if (!events || events.length === 0) return null
  return (
    <Card accessibilityLabel="Upcoming campus events">
      <Text style={[styles.kicker, { color: colors.purple }]}>CAMPUS CALENDAR</Text>
      {bonus ? <Text style={{ color: colors.orange, fontWeight: '800' }}>Bonus live now: {bonus}</Text> : null}
      {events.map((e) => (
        <View key={e.id} style={styles.row}>
          <Text style={[styles.day, { color: colors.inkSecondary }]}>{e.day}</Text>
          <View style={styles.body}>
            <Text style={[styles.title, { color: colors.title }]}>{e.title}</Text>
            <Text style={{ color: colors.inkSecondary }}>{e.label}{e.bonus ? ` · ${e.bonus}` : ''}</Text>
          </View>
        </View>
      ))}
    </Card>
  )
}

const styles = StyleSheet.create({
  kicker: { fontWeight: '800', letterSpacing: 1.1, fontSize: 12 },
  row: { flexDirection: 'row', gap: 12, marginTop: 8 },
  day: { width: 86, fontWeight: '700' },
  body: { flex: 1 },
  title: { fontWeight: '800', fontSize: 15 },
})
