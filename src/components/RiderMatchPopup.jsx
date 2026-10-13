import { uniqueChannelTopic } from '../../packages/rides-native/realtimeChannel.js'
import { useEffect, useRef, useState } from 'react'
import { A11yModalDialog } from './A11yModal'
import { PrimaryButton } from './PrimaryButton'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { pushToast } from '../lib/toasts'
import { fetchMatchNotice } from '../lib/scheduledRides'
import { navigate } from '../lib/navigation'
import { buildRiderMatchNotice } from '../../shared/nearTermSlots.js'

const MATCHED = ['accepted', 'arriving', 'arrived', 'in_progress']

/**
 * Screen pop-up when a driver is matched: who, how far, and the pickup time.
 * Also raises the in-app ride notification.
 */
export function RiderMatchPopup() {
  const { user } = useAuth()
  const seen = useRef(new Map())
  const primed = useRef(false)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    if (!supabase || !user?.id) return undefined
    let alive = true
    primed.current = false
    seen.current = new Map()

    async function present(row) {
      let next = null
      try {
        next = await fetchMatchNotice(row.id)
      } catch {
        next = buildRiderMatchNotice({
          pickupAt: row.pickup_at || row.scheduled_for || row.metadata?.scheduled_pickup_at,
        })
      }
      if (!alive) return
      const card = { ...next, tripId: row.id }
      pushToast({
        id: `match-${row.id}`,
        kind: 'driver_matched',
        title: card.title || 'Driver matched',
        body: card.body,
        durationMs: 8000,
      })
      setNotice(card)
    }

    function consider(row) {
      if (!row?.id || row.rider_id && row.rider_id !== user.id) return
      const matched = MATCHED.includes(row.status) && row.driver_id
      const prev = seen.current.get(row.id)
      seen.current.set(row.id, row.status)
      if (!primed.current || !matched || prev === row.status) return
      if (prev == null) return
      present(row)
    }

    async function load() {
      const { data, error } = await supabase
        .from('trips')
        .select('id, status, rider_id, driver_id, pickup_label, dropoff_label, pickup_at, scheduled_for, metadata')
        .eq('rider_id', user.id)
        .order('requested_at', { ascending: false })
        .limit(8)
      if (!alive || error) return
      if (!primed.current) {
        ;(data || []).forEach((row) => seen.current.set(row.id, row.status))
        primed.current = true
        return
      }
      ;(data || []).forEach(consider)
    }

    load()
    const channel = supabase
      .channel(uniqueChannelTopic(`rider-match-${user.id}`))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trips', filter: `rider_id=eq.${user.id}` }, (payload) => {
        consider(payload.new)
      })
      .subscribe()
    const poll = setInterval(load, 8000)
    return () => {
      alive = false
      clearInterval(poll)
      supabase.removeChannel(channel)
    }
  }, [user?.id])

  return (
    <A11yModalDialog
      open={Boolean(notice)}
      onClose={() => setNotice(null)}
      titleId="rider-match-title"
    >
      {notice && (
        <div style={{ padding: 22, maxWidth: 420 }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 800, letterSpacing: 0.6, color: '#F56600' }}>MATCHED</p>
          <h2 id="rider-match-title" style={{ margin: '6px 0 8px', color: '#522D80' }}>{notice.title || 'Driver matched'}</h2>
          <p style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 800 }}>{notice.driverName || 'Your driver'}</p>
          <p style={{ margin: '0 0 6px' }}>{notice.distanceLabel ? `${notice.distanceLabel} from pickup` : 'Distance shows when your driver shares a location.'}</p>
          {notice.etaLabel && <p style={{ margin: '0 0 6px' }}>About {notice.etaLabel} out</p>}
          <p style={{ margin: '0 0 16px', fontWeight: 700 }}>{notice.pickupLabel ? `Pickup ${notice.pickupLabel}` : 'Pickup time follows their ETA.'}</p>
          <PrimaryButton onClick={() => { const id = notice.tripId; setNotice(null); navigate('requested', { trip: id }) }}>
            View ride
          </PrimaryButton>
          <button type="button" className="pressable" onClick={() => setNotice(null)} style={{ marginTop: 10, fontWeight: 700, color: '#522D80' }}>
            Dismiss
          </button>
        </div>
      )}
    </A11yModalDialog>
  )
}
