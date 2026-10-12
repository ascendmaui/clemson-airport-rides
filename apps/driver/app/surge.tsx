import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { Text } from 'react-native'
import { Card, ErrorText } from '@/components/chrome'
import { StackPage } from '@/components/shell'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { loadDriverPerks, type SurgeView } from 'rides-native/driverDesk'

const fmt = (iso: string) => new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function SurgeScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const [surge, setSurge] = useState<SurgeView | null>(null)
  const [error, setError] = useState<string | null>(null)
  useFocusEffect(useCallback(() => {
    if (!supabase) return undefined
    loadDriverPerks(supabase).then((p) => setSurge((p.surge as SurgeView) || null)).catch((e: Error) => setError(e.message))
    return undefined
  }, []))
  const bonus = surge?.driverBonusCents ? `$${(surge.driverBonusCents / 100).toFixed(2)}` : null
  return (
    <StackPage title="Game-day surge" onBack={() => router.back()}>
      <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
        {`Be within ${surge?.radiusKm ?? 1.5} km of a live zone to get matched first for pickups there.${bonus ? ` Each trip picked up in a live zone adds a ${bonus} driver bonus to your payouts.` : ''} Rider fares are set separately.`}
      </Text>
      {surge?.zones?.length ? surge.zones.map((z) => (
        <Card key={z.id}>
          <Text style={{ color: z.live ? colors.orange : colors.title, fontWeight: '800' }}>{`${z.live ? 'LIVE · ' : ''}${z.title}`}</Text>
          {z.label ? <Text style={{ color: colors.ink }}>{z.label}</Text> : null}
          <Text style={{ color: colors.inkSecondary }}>{`${fmt(z.startsAt)} – ${fmt(z.endsAt)}`}</Text>
        </Card>
      )) : <Card><Text style={{ color: colors.inkSecondary }}>No game-day or event zones in the next day and a half.</Text></Card>}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </StackPage>
  )
}
