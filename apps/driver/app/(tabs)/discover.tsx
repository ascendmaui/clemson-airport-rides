import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Card, Primary } from '@/components/chrome'
import { useTheme } from '@/lib/theme'
import { supabase } from '@/lib/supabase'
import { loadGameDay } from 'rides-native/driverDesk'
import { HEAT_WINDOWS } from 'rides-native/places.js'
import { loadBusySpots, type BusySpot } from '@/lib/busySpots'

function demandWord(intensity: number): string {
  if (intensity >= 0.75) return 'Busy'
  if (intensity >= 0.45) return 'Picking up'
  if (intensity >= 0.22) return 'Light'
  return 'Quiet'
}

export default function DiscoverScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const [windowId, setWindowId] = useState('now')
  const [game, setGame] = useState<string | null>(null)
  const [spots, setSpots] = useState<BusySpot[]>([])
  const [caption, setCaption] = useState('Typical campus patterns for College Ave, the stadium, and the dorms.')
  const [blended, setBlended] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    loadBusySpots(windowId)
      .then((result) => {
        if (!alive) return
        setSpots(result.spots.slice().sort((a, b) => b.intensity - a.intensity))
        setCaption(result.caption)
        setBlended(result.blended)
      })
      .catch(() => {
        if (!alive) return
        setSpots([])
        setCaption('Could not load campus demand.')
        setBlended(false)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [windowId])

  useEffect(() => {
    if (!supabase) return
    loadGameDay(supabase).then((row) => {
      if (!row) {
        setGame(null)
        return
      }
      const surge = row.surge_multiplier ? ` · rider fare ${row.surge_multiplier}×` : ''
      setGame(`${row.title || 'Game day'}${row.pickup_zone_label ? ` · ${row.pickup_zone_label}` : ''}${surge}`)
    }).catch(() => setGame(null))
  }, [])

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + 12 }]}>
      <ScrollView contentContainerStyle={styles.list}>
        <Text style={[styles.kicker, { color: colors.orange }]}>DISCOVER</Text>
        <Text style={[styles.title, { color: colors.title }]}>Campus demand</Text>
        <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
          {loading ? 'Loading campus demand…' : `${caption}${blended ? ' Live requests are blended in when available.' : ' Typical patterns when live demand is quiet.'}`}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {HEAT_WINDOWS.map((item) => {
            const on = item.id === windowId
            return (
              <Pressable key={item.id} onPress={() => setWindowId(item.id)} style={[styles.chip, { backgroundColor: on ? colors.fill : colors.card }]}>
                <Text style={{ color: on ? colors.onAccent : colors.title, fontWeight: '800' }}>{item.label}</Text>
              </Pressable>
            )
          })}
        </ScrollView>
        {game ? (
          <Card>
            <Text style={[styles.cardTitle, { color: colors.title }]}>Game day</Text>
            <Text style={{ color: colors.ink }}>{game}</Text>
          </Card>
        ) : null}
        {spots.map((spot) => (
          <Card key={spot.id}>
            <View style={styles.spotHead}>
              <Text style={[styles.cardTitle, { color: colors.title }]}>{spot.name}</Text>
              <Text style={{ color: colors.orange, fontWeight: '800' }}>{demandWord(spot.intensity)}</Text>
            </View>
            <View style={[styles.track, { backgroundColor: colors.track }]}>
              <View style={[styles.fill, { width: `${Math.round(spot.intensity * 100)}%`, backgroundColor: colors.orange }]} />
            </View>
          </Card>
        ))}
        <Primary label="Open the ride queue" onPress={() => router.push('/queue')} />
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { padding: 16, gap: 12, paddingBottom: 32 },
  kicker: { fontWeight: '800', letterSpacing: 1.1, fontSize: 12 },
  title: { fontSize: 28, fontWeight: '800' },
  chips: { gap: 8 },
  chip: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  cardTitle: { fontWeight: '800', fontSize: 16 },
  spotHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  track: { height: 8, borderRadius: 999, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 999 },
})
