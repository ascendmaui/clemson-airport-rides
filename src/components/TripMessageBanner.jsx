import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { navigate } from '../lib/navigation'
import { supabase } from '../lib/supabase'
import { pushToast } from '../lib/toasts'
import { lostItemBannerFollowUp, lostItemBannerLine, lostItemToast } from '../../shared/copy/messaging.js'
import { lostItemReportState } from '../lib/tripChatRules'
import { subscribeLostItemReports } from '../lib/tripMessages'
import { MessagingInfoButton } from './MessagingInfo'

const COLS = 'id, trip_id, reporter_id, reporter_role, description, status, opened_at'

export function TripMessageBanner() {
  const { user } = useAuth()
  const [report, setReport] = useState(null)

  useEffect(() => {
    if (!supabase || !user?.id) return undefined
    let alive = true
    const seen = new Set()
    async function load(announce) {
      const { data, error } = await supabase
        .from('trip_lost_item_reports')
        .select(COLS)
        .eq('status', 'open')
        .order('opened_at', { ascending: false })
        .limit(8)
      if (!alive || error) return
      const rows = data || []
      const next = rows.find((row) => row.reporter_id !== user.id && lostItemReportState(row) === 'open') || null
      if (announce && next && !seen.has(next.id)) {
        seen.add(next.id)
        const toast = lostItemToast()
        pushToast({
          kind: 'trip_lost_item',
          title: toast.title,
          body: next.description ? `${toast.body} ${next.description}` : toast.body,
          force: true,
        })
      }
      rows.forEach((row) => seen.add(row.id))
      setReport(next)
    }
    load(false).catch(() => {})
    const unsub = subscribeLostItemReports((payload) => {
      const row = payload?.new
      if (row?.reporter_id && row.reporter_id !== user.id) load(true).catch(() => {})
      else load(false).catch(() => {})
    })
    return () => {
      alive = false
      unsub()
    }
  }, [user?.id])

  if (!report) return null
  return (
    <div
      data-testid="lost-item-banner"
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        right: 12,
        zIndex: 40,
        padding: '12px 14px',
        borderRadius: 16,
        background: 'var(--surface)',
        color: 'var(--ink)',
        boxShadow: 'var(--shadow-modal)',
        border: '1px solid rgba(245,102,0,0.35)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ color: '#F56600', fontWeight: 800, letterSpacing: 0.6, fontSize: 12 }}>LOST ITEM</div>
          <div style={{ fontWeight: 700, marginTop: 4 }}>{lostItemBannerLine(report.description)}</div>
          <div style={{ marginTop: 4, fontSize: 13, lineHeight: 1.4 }}>{lostItemBannerFollowUp()}</div>
          <button
            type="button"
            className="pressable"
            onClick={() => {
              if (report.reporter_role === 'rider') navigate('driver', { chat: report.trip_id })
              else navigate('requested', { trip: report.trip_id })
            }}
            style={{ marginTop: 8, fontWeight: 800, color: 'var(--purple)', minHeight: 44 }}
          >
            Open messages
          </button>
        </div>
        <MessagingInfoButton role={report.reporter_role === 'rider' ? 'driver' : 'rider'} />
      </div>
    </div>
  )
}
