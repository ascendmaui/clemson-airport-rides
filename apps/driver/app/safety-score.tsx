import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { Text } from 'react-native'
import { Card, ErrorText } from '@/components/chrome'
import { StackPage } from '@/components/shell'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { loadDriverPerks, type SafetyScoreView } from 'rides-native/driverDesk'

const NAMES: Record<string, string> = { braking: 'Hard braking', speeding: 'Speeding', sos: 'SOS events', ratings: 'Rider ratings', cancels: 'Cancellations' }

export default function SafetyScoreScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const [s, setS] = useState<SafetyScoreView | null>(null)
  const [error, setError] = useState<string | null>(null)
  useFocusEffect(useCallback(() => {
    if (!supabase) return undefined
    loadDriverPerks(supabase).then((p) => setS((p.safety as SafetyScoreView) || null)).catch((e: Error) => setError(e.message))
    return undefined
  }, []))
  return (
    <StackPage title="Safety score" onBack={() => router.back()}>
      <Card>
        <Text style={{ color: colors.orange, fontWeight: '800', letterSpacing: 1.1, fontSize: 12 }}>ESTIMATE · LAST 30 DAYS</Text>
        <Text style={{ color: colors.ink, fontSize: 40, fontWeight: '800' }} accessibilityLabel={`Estimated safety score ${s?.score ?? 'loading'} out of 100`}>{s?.score ?? '…'}</Text>
        <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
          {`This is an estimate from your phone’s GPS, SOS events, rider ratings and cancellations. It is not an official driving record.${s?.affectsDispatch ? ' It is currently used in matching.' : ' It does not affect which trips you get.'}`}
        </Text>
        {s && !s.hasGps ? <Text style={{ color: colors.inkSecondary }}>Not enough trip GPS yet for braking and speed.</Text> : null}
      </Card>
      {s?.factors?.length ? (
        <Card>
          {s.factors.map((f) => (
            <Text key={f.key} style={{ color: colors.title }}>{`${NAMES[f.key] || f.key}: ${f.penalty > 0 ? `−${f.penalty}` : 'no deduction'} · ${f.detail}`}</Text>
          ))}
        </Card>
      ) : null}
      {s?.tips?.length ? (
        <Card>
          <Text style={{ color: colors.title, fontWeight: '800' }}>Tips</Text>
          {s.tips.map((t, i) => <Text key={i} style={{ color: colors.inkSecondary, lineHeight: 20 }}>{`• ${t}`}</Text>)}
        </Card>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </StackPage>
  )
}
