import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { Card, ErrorText } from '@/components/chrome'
import { StackPage } from '@/components/shell'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { loadDriverPerks, type Leaderboard, type LeaderRow } from 'rides-native/driverDesk'

export default function LeaderboardScreen() {
  const router = useRouter()
  const { colors, earningsPrivate } = useTheme()
  const [board, setBoard] = useState<Leaderboard | null>(null)
  const [tab, setTab] = useState<'trips' | 'earnings'>('trips')
  const [error, setError] = useState<string | null>(null)
  useFocusEffect(useCallback(() => {
    if (!supabase) return undefined
    loadDriverPerks(supabase).then((p) => setBoard((p.leaderboard as Leaderboard) || null)).catch((e: Error) => setError(e.message))
    return undefined
  }, []))
  const rows: LeaderRow[] = (tab === 'trips' ? board?.byTrips : board?.byEarnings) || []
  const me = tab === 'trips' ? board?.you?.trips : board?.you?.earnings
  const value = (r: LeaderRow) => (tab === 'trips' ? `${r.trips} trips` : earningsPrivate ? '•••' : `$${(r.earningsCents / 100).toFixed(0)}`)
  return (
    <StackPage title="This week’s leaders" onBack={() => router.back()}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['trips', 'earnings'] as const).map((k) => (
          <Pressable key={k} onPress={() => setTab(k)} accessibilityRole="button" accessibilityLabel={k === 'trips' ? 'Rank by trips' : 'Rank by earnings'} accessibilityState={{ selected: tab === k }}
            style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: tab === k ? colors.orange : colors.card }}>
            <Text style={{ color: tab === k ? '#fff' : colors.title, fontWeight: '800' }}>{k === 'trips' ? 'Trips' : 'Earnings'}</Text>
          </Pressable>
        ))}
      </View>
      <Card>
        {rows.length ? rows.map((r) => (
          <View key={`${tab}-${r.rank}`} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }} accessible accessibilityLabel={`Rank ${r.rank}, ${r.name}, ${value(r)}`}>
            <Text style={{ color: r.you ? colors.orange : colors.title, fontWeight: '800' }}>{`${r.rank}. ${r.name}${r.you ? ' (you)' : ''}`}</Text>
            <Text style={{ color: colors.inkSecondary, fontWeight: '700' }}>{value(r)}</Text>
          </View>
        )) : <Text style={{ color: colors.inkSecondary }}>No completed trips yet this week.</Text>}
      </Card>
      {me && !rows.some((r) => r.you) ? <Text style={{ color: colors.inkSecondary }}>{`You’re #${me.rank} · ${value(me)}`}</Text> : null}
      <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
        {board?.optedOut
          ? 'You’re hidden from the leaderboard. Turn it back on in Account.'
          : 'Week starts Monday, Eastern time. Only first name and last initial are shown. Hide yourself in Account.'}
      </Text>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </StackPage>
  )
}
