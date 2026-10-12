import { useFocusEffect } from 'expo-router'
import { useCallback, useState, type ReactNode } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { firstRideChipCopy, loadDriverPerks, type DriverPerks, type StreakView } from 'rides-native/driverDesk'
import { useCardShadow } from '@/components/chrome'
import { useAuth } from '@/lib/auth'
import type { Palette } from '@/lib/palette'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'

const dollars = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`

/** Compact horizontal perk chips on Home. Each perk adds one chip here. */
export function PerksStrip() {
  const { user } = useAuth()
  const [perks, setPerks] = useState<DriverPerks | null>(null)
  useFocusEffect(useCallback(() => {
    if (!user || !supabase) return undefined
    let alive = true
    loadDriverPerks(supabase).then((p) => { if (alive) setPerks(p) }).catch(() => {})
    return () => { alive = false }
  }, [user]))
  if (!perks) return null
  const chips: ReactNode[] = []
  const ride = firstRideChipCopy(perks.firstRide)
  if (ride) chips.push(<PerkChip key="first-ride" title={ride.title} line={ride.line} tone={ride.tone} />)
  const s = perks.streaks
  if (s?.trips?.enabled) chips.push(<StreakChip key="trips" label="Trip streak" unit="trips" view={s.trips} />)
  if (s?.days?.enabled) chips.push(<StreakChip key="days" label="Day streak" unit="days" view={s.days} />)
  if (!chips.length) return null
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} accessibilityLabel="Driver perks">
      {chips}
    </ScrollView>
  )
}

export function PerkChip({ title, line, progress, tone, accessibilityLabel }: { title: string; line: string; progress?: number; tone?: 'orange' | 'purple'; accessibilityLabel?: string }) {
  const { colors } = useTheme()
  const shadow = useCardShadow()
  const accent = toneColor(colors, tone)
  return (
    <View
      style={[styles.chip, shadow, {
        backgroundColor: tone === 'orange' ? colors.orangeSoft : tone === 'purple' ? colors.purpleSoft : colors.card,
        borderLeftWidth: tone ? 3 : 0,
        borderLeftColor: accent,
      }]}
      accessible
      accessibilityLabel={accessibilityLabel || `${title}. ${line}`}
    >
      <Text style={{ color: accent, fontWeight: '800', fontSize: 13 }}>{title}</Text>
      <Text style={{ color: colors.inkSecondary, fontSize: 12 }}>{line}</Text>
      {progress != null ? (
        <View style={[styles.track, { backgroundColor: colors.track }]}>
          <View style={[styles.fill, { backgroundColor: colors.orange, width: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` }]} />
        </View>
      ) : null}
    </View>
  )
}

function toneColor(colors: Palette, tone?: 'orange' | 'purple') {
  switch (tone) {
    case 'orange':
      return colors.orange
    case 'purple':
      return colors.purple
    case undefined:
      return colors.title
    default: {
      const unknown: never = tone
      return unknown
    }
  }
}

function StreakChip({ label, unit, view }: { label: string; unit: string; view: StreakView }) {
  const done = view.target - view.toNext
  return (
    <PerkChip
      title={`${label} ${done}/${view.target}`}
      line={`${view.toNext} more ${unit} for ${dollars(view.bonusCents)}`}
      progress={view.progress}
    />
  )
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingHorizontal: 16, paddingVertical: 6 },
  chip: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, minWidth: 150, gap: 2 },
  track: { height: 4, borderRadius: 2, marginTop: 4, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
})
