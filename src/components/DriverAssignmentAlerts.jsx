import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { enableDriverWebPush } from '../lib/driverWebPush'
import { supabase } from '../lib/supabase'

const PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY || ''

async function saveSubscription(driverId, subscription) {
  if (!supabase || !subscription?.endpoint) return { error: { message: 'Missing subscription' } }
  return supabase.from('driver_web_push').upsert({
    driver_id: driverId,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys?.p256dh,
    auth: subscription.keys?.auth,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' })
}

/** On-screen assignment notice and the driver-only browser push prompt. */
export function DriverAssignmentAlerts() {
  const { user } = useAuth()
  const [notice, setNotice] = useState(null)
  const [pushNote, setPushNote] = useState(null)
  const [permission, setPermission] = useState(() => (
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
  ))

  useEffect(() => {
    if (!supabase || !user?.id) return undefined
    let alive = true
    const load = async () => {
      const { data } = await supabase
        .from('driver_notifications')
        .select('id, title, body, trip_id, created_at')
        .eq('driver_id', user.id)
        .eq('kind', 'ride_assigned')
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
      if (!alive) return
      setNotice(data?.[0] || null)
    }
    load().catch(() => {})
    const channel = supabase
      .channel(`driver-assignment-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'driver_notifications',
        filter: `driver_id=eq.${user.id}`,
      }, (payload) => {
        if (payload.new?.kind === 'ride_assigned') setNotice(payload.new)
      })
      .subscribe()
    const poll = setInterval(() => { load().catch(() => {}) }, 12000)
    if (permission === 'granted' && PUBLIC_KEY) {
      enableDriverWebPush(PUBLIC_KEY, { prompt: false })
        .then((result) => {
          if (result.ok) return saveSubscription(user.id, result.subscription)
          return null
        })
        .catch(() => {})
    }
    return () => {
      alive = false
      clearInterval(poll)
      supabase.removeChannel(channel)
    }
  }, [permission, user?.id])

  if (!user?.id) return null

  async function allowPush() {
    const result = await enableDriverWebPush(PUBLIC_KEY)
    setPermission(result.permission || 'denied')
    if (!result.ok) {
      setPushNote(result.reason === 'missing_vapid_public_key'
        ? 'Notification permission is on. Closed-tab alerts still need the server VAPID key.'
        : 'Assignment alerts stay off until this browser allows notifications.')
      return
    }
    const saved = await saveSubscription(user.id, result.subscription)
    setPushNote(saved?.error
      ? 'Permission is on. Saving this browser for closed-tab alerts failed.'
      : 'This browser will get assignment alerts even when the tab is closed.')
  }

  async function dismiss() {
    if (notice?.id && supabase) {
      await supabase.from('driver_notifications').update({ read_at: new Date().toISOString() }).eq('id', notice.id)
    }
    setNotice(null)
  }

  if (permission !== 'default' && !pushNote && !notice) return null

  return (
    <div style={{ position: 'absolute', top: 72, left: 16, right: 16, zIndex: 30, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {permission === 'default' ? (
        <button
          type="button"
          className="pressable"
          onClick={allowPush}
          style={{
            alignSelf: 'flex-start',
            background: '#F56600',
            color: '#fff',
            fontWeight: 800,
            borderRadius: 999,
            padding: '8px 14px',
            boxShadow: '0 8px 24px rgba(245, 102, 0, 0.28)',
          }}
        >
          Allow assignment alerts
        </button>
      ) : null}
      {pushNote ? (
        <p style={{ margin: 0, background: '#fff', color: '#522D80', borderRadius: 14, padding: '10px 12px', fontSize: 13, fontWeight: 700 }}>
          {pushNote}
        </p>
      ) : null}
      {notice ? (
        <div role="status" aria-live="polite" style={{ background: '#fff', border: '1.5px solid rgba(245, 102, 0, 0.45)', borderRadius: 16, padding: '12px 14px' }}>
          <div style={{ fontWeight: 800, color: '#F56600' }}>{notice.title}</div>
          <p style={{ margin: '4px 0 8px', color: '#522D80', fontSize: 13, lineHeight: 1.4 }}>{notice.body}</p>
          <button type="button" className="pressable" onClick={dismiss} style={{ fontWeight: 800, color: '#522D80' }}>
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  )
}
