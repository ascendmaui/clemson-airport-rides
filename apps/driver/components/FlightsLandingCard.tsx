import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Card } from '@/components/chrome'
import { useTheme } from '@/lib/theme'
import { supabase } from '@/lib/supabase'
import { quiet } from '@/lib/softFail'
import { loadArrivalWaves, waveCardLine, type ArrivalWave } from 'rides-native/flightStatus'

/** Discover: "Flights landing" at GSP, next 3 hours, refreshed every 2 minutes. */
export function FlightsLandingCard({ airport = 'GSP' }: { airport?: string }) {
  const { colors } = useTheme()
  const [waves, setWaves] = useState<ArrivalWave[] | null>(null)
  useEffect(() => {
    let alive = true
    // Optional card: on failure it keeps the last waves (or stays hidden) and retries on the next tick.
    const load = () => loadArrivalWaves(supabase, airport, 3).then((rows) => { if (alive) setWaves(rows) }).catch(quiet('flights landing'))
    load()
    const timer = setInterval(load, 120000)
    return () => { alive = false; clearInterval(timer) }
  }, [airport])
  if (!waves) return null
  const top = waves.slice().sort((a, b) => Number(b.score) - Number(a.score))[0]
  return (
    <Card accessibilityLabel={`Flights landing at ${airport}`}>
      <Text style={[styles.kicker, { color: colors.orange }]}>FLIGHTS LANDING · {airport}</Text>
      {waves.length === 0 ? (
        <Text style={{ color: colors.inkSecondary }}>No arrival waves in the next 3 hours.</Text>
      ) : (
        <>
          {top ? <Text style={[styles.title, { color: colors.title }]}>{waveCardLine(top)?.stage}</Text> : null}
          {waves.slice(0, 5).map((w) => {
            const line = waveCardLine(w)
            return (
              <View key={w.wave_start} style={styles.row}>
                <Text style={[styles.when, { color: colors.title }]}>{line?.when}</Text>
                <Text style={{ color: colors.inkSecondary, flex: 1 }}>{line?.what}</Text>
              </View>
            )
          })}
          <Text style={{ color: colors.inkSecondary, fontSize: 12 }}>{top ? waveCardLine(top)?.quality : ''}. Stage about 20 minutes before a wave.</Text>
        </>
      )}
    </Card>
  )
}

const styles = StyleSheet.create({
  kicker: { fontWeight: '800', letterSpacing: 1.1, fontSize: 12 },
  title: { fontWeight: '800', fontSize: 16 },
  row: { flexDirection: 'row', gap: 12, marginTop: 6 },
  when: { width: 140, fontWeight: '700' },
})
