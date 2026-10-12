import { useEffect, useState } from 'react'
import { Text } from 'react-native'
import { Card, Tag } from '@/components/chrome'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { authedJson } from 'rides-native/apiClient'

type Dispute = { status: string; reason: string | null; summary_text: string; generated_at: string }

/** Shows the fare dispute summary for this trip, if the rider opened one. */
export function DisputeSummaryCard({ tripId }: { tripId: string }) {
  const { colors } = useTheme()
  const [dispute, setDispute] = useState<Dispute | null>(null)
  useEffect(() => {
    let alive = true
    authedJson(supabase, '/api/trip-messages?action=dispute-summary', { method: 'POST', body: { tripId } })
      .then((result: any) => { if (alive) setDispute(result?.dispute || null) })
      .catch(() => {})
    return () => { alive = false }
  }, [tripId])
  if (!dispute) return null
  return (
    <Card accessibilityLabel="Fare dispute summary">
      <Tag label={dispute.status === 'resolved' ? 'Dispute resolved' : 'Fare disputed'} tone="orange" />
      <Text style={{ color: colors.inkSecondary, fontSize: 12 }}>
        The rider contested this fare. Support reviews the summary below. You don't need to do anything unless support contacts you.
      </Text>
      <Text selectable style={{ color: colors.ink, fontSize: 12, lineHeight: 18, fontFamily: 'Menlo' }}>{dispute.summary_text}</Text>
    </Card>
  )
}
