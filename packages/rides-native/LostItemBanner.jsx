import { useCallback, useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { lostItemReportState, subscribeLostItemReports } from './tripMessagesClient.js'

const COLS = 'id, trip_id, reporter_id, description, status, opened_at'

async function loadOpenReport(supabase, userId) {
  const { data, error } = await supabase
    .from('trip_lost_item_reports')
    .select(COLS)
    .eq('status', 'open')
    .order('opened_at', { ascending: false })
    .limit(8)
  if (error) return null
  const rows = Array.isArray(data) ? data : []
  return rows.find((row) => row.reporter_id !== userId && lostItemReportState(row) === 'open') || null
}

export function LostItemBanner({ supabase, userId, colors, onOpen }) {
  const [report, setReport] = useState(null)
  const refresh = useCallback(async () => {
    if (!supabase || !userId) {
      setReport(null)
      return
    }
    const next = await loadOpenReport(supabase, userId)
    setReport(next)
  }, [supabase, userId])

  useEffect(() => {
    if (!supabase || !userId) return undefined
    refresh().catch(() => {})
    const unsub = subscribeLostItemReports(supabase, () => {
      refresh().catch(() => {})
    })
    return unsub
  }, [refresh, supabase, userId])

  if (!report) return null
  const tone = colors || {}
  const detail = report.description ? ` · ${report.description}` : ''
  return (
    <View style={{
      marginHorizontal: 16,
      marginTop: 8,
      padding: 14,
      borderRadius: 16,
      backgroundColor: tone.orangeSoft || 'rgba(245,102,0,0.16)',
      gap: 6,
    }}>
      <Text style={{ color: tone.orange || '#F56600', fontWeight: '800', letterSpacing: 0.6, fontSize: 12 }}>LOST ITEM</Text>
      <Text style={{ color: tone.ink || '#F5F6F8', fontWeight: '700', fontSize: 15 }}>
        A lost item was reported on your ride{detail}.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open lost item messages"
        onPress={() => onOpen?.(report.trip_id)}
        style={{ minHeight: 44, justifyContent: 'center' }}
      >
        <Text style={{ color: tone.link || '#522D80', fontWeight: '800' }}>Open messages</Text>
      </Pressable>
    </View>
  )
}
