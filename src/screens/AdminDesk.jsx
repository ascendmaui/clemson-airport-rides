import { useEffect, useState } from 'react'
import { AdminDrivers } from './AdminDrivers'
import { navigate, getHashRoute } from '../lib/navigation'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { SEEDED_ADMIN_EMAILS, isAdminIdentity } from '../lib/driverOnboarding'
import {
  fetchAdminNotifications,
  fetchAdminOverview,
  fetchAdminPeople,
  fetchAdminTicket,
  fetchAdminTickets,
  fetchAdminTrips,
  markAdminNotifications,
  replyAdminTicket,
} from '../lib/adminDesk'

const TABS = [
  ['notifications', 'Notifications'],
  ['applications', 'Applicants'],
  ['people', 'People'],
  ['trips', 'Trips'],
  ['support', 'Support'],
]

const TICKET_FILTERS = [
  ['escalated', 'Escalated'],
  ['waiting_user', 'Waiting'],
  ['bot_handling', 'Bot'],
  ['open', 'Open'],
  ['resolved', 'Resolved'],
  ['', 'All'],
]

function readTab() {
  const tab = getHashRoute().params.tab
  return TABS.some(([id]) => id === tab) ? tab : 'notifications'
}

export function AdminDesk() {
  const { user, loading } = useAuth()
  const [allowed, setAllowed] = useState(null)
  const [tab, setTab] = useState(readTab)
  const [overview, setOverview] = useState(null)

  useEffect(() => {
    const sync = () => setTab(readTab())
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  useEffect(() => {
    if (loading) return undefined
    if (!user?.id || !supabase) {
      setAllowed(false)
      return undefined
    }
    let alive = true
    supabase.from('profiles').select('role, is_admin, email').eq('id', user.id).maybeSingle()
      .then(({ data }) => {
        if (!alive) return
        setAllowed(isAdminIdentity({
          jwtEmail: user.email || data?.email,
          role: data?.role,
          isAdmin: data?.is_admin,
        }))
      })
    return () => { alive = false }
  }, [user, loading])

  useEffect(() => {
    if (!allowed) return undefined
    fetchAdminOverview().then(setOverview).catch(() => setOverview(null))
    return undefined
  }, [allowed, tab])

  if (loading || allowed == null) {
    return <div style={{ padding: 40, color: 'var(--ink-secondary)' }}>Loading admin dashboard…</div>
  }

  if (!allowed) {
    return (
      <div className="fade-in" style={{ minHeight: '100%', background: 'var(--surface-muted)', padding: 24 }}>
        <button type="button" className="pressable" onClick={() => navigate('account')} style={{ fontSize: 20 }}>←</button>
        <h1 style={{ color: 'var(--purple)', marginTop: 12 }}>Admin only</h1>
        <p style={{ color: 'var(--ink-secondary)', lineHeight: 1.45 }}>
          Sign in with {SEEDED_ADMIN_EMAILS.join(', ')}. The dashboard is at #/admin. A profile with role admin also has access.
        </p>
      </div>
    )
  }

  return (
    <div className="fade-in" style={{ minHeight: '100%', background: 'var(--surface-muted)', padding: '20px 20px 48px' }}>
      <button type="button" className="pressable" onClick={() => navigate('account')} style={{ fontSize: 20 }}>←</button>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.1, color: '#F56600', marginTop: 12 }}>CLEMSON RIDES</div>
      <h1 style={{ fontSize: 28, fontWeight: 800, color: '#522D80', margin: '4px 0 0', letterSpacing: -0.4 }}>Admin</h1>
      <p style={{ color: 'var(--ink-secondary)', fontSize: 14, lineHeight: 1.45 }}>
        Riders, drivers, applications, trips, and support. Approving a driver unlocks ride accept.
        {overview?.migrationRequired ? ' Apply supabase/migrations/20260924190000_admin_support.sql to turn on notifications and the support inbox.' : ''}
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: 14, overflowX: 'auto' }}>
        {TABS.map(([id, label]) => {
          const badge = id === 'notifications' ? overview?.unreadNotifications
            : id === 'applications' ? overview?.pendingApplications
              : id === 'support' ? overview?.escalatedTickets
                : 0
          return (
            <button
              key={id}
              type="button"
              className="pressable"
              onClick={() => navigate('admin', { tab: id })}
              style={{
                flex: '0 0 auto',
                padding: '8px 12px',
                borderRadius: 999,
                fontWeight: 700,
                fontSize: 12,
                color: tab === id ? '#fff' : '#522D80',
                background: tab === id ? '#F56600' : 'white',
                border: '1px solid rgba(82,45,128,0.15)',
              }}
            >
              {label}{badge ? ` ${badge}` : ''}
            </button>
          )
        })}
      </div>
      {tab === 'notifications' && <NotificationsPanel onChanged={() => fetchAdminOverview().then(setOverview).catch(() => {})} />}
      {tab === 'applications' && <AdminDrivers embedded />}
      {tab === 'people' && <PeoplePanel />}
      {tab === 'trips' && <TripsPanel />}
      {tab === 'support' && <SupportPanel />}
    </div>
  )
}

function NotificationsPanel({ onChanged }) {
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')

  async function load() {
    const data = await fetchAdminNotifications()
    setRows(data.notifications || [])
    if (data.error) setError(data.error)
  }

  useEffect(() => {
    load().catch((err) => setError(err.message || String(err)))
  }, [])

  async function mark(id) {
    await markAdminNotifications(id ? { id } : { all: true })
    await load()
    onChanged?.()
  }

  return (
    <section style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 18, color: '#522D80', margin: 0 }}>New submissions</h2>
        <button type="button" className="pressable" onClick={() => mark()} style={{ fontWeight: 700, color: '#F56600' }}>Mark all read</button>
      </div>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {rows.length === 0 && <p style={{ color: 'var(--ink-secondary)' }}>No notifications yet. A new driver application shows up here.</p>}
      {rows.map((row) => (
        <button
          key={row.id}
          type="button"
          className="sheet pressable"
          onClick={() => {
            mark(row.id).catch(() => {})
            if (row.entity_type === 'support_ticket') navigate('admin', { tab: 'support' })
            if (row.entity_type === 'driver_application') navigate('admin', { tab: 'applications' })
          }}
          style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: 10, padding: 14, borderRadius: 16, opacity: row.read_at ? 0.65 : 1 }}
        >
          <div style={{ fontSize: 12, fontWeight: 800, color: '#F56600' }}>{row.kind}</div>
          <div style={{ fontWeight: 800, color: '#522D80' }}>{row.title}</div>
          <div style={{ fontSize: 13, color: 'var(--ink-secondary)', marginTop: 4 }}>{row.body}</div>
        </button>
      ))}
    </section>
  )
}

function PeoplePanel() {
  const [role, setRole] = useState('all')
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    fetchAdminPeople(role === 'all' ? '' : role)
      .then((data) => setRows(data.people || []))
      .catch((err) => setError(err.message || String(err)))
  }, [role])

  return (
    <section style={{ marginTop: 16 }}>
      <ChipRow value={role} onChange={setRole} options={[['all', 'All'], ['rider', 'Riders'], ['driver', 'Drivers'], ['admin', 'Admins']]} />
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {rows.map((row) => (
        <div key={row.id} className="sheet" style={{ marginTop: 10, padding: 14, borderRadius: 16 }}>
          <div style={{ fontWeight: 800, color: '#522D80' }}>{row.full_name || 'No name'}</div>
          <div style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>{row.email}{row.phone ? ` · ${row.phone}` : ''}</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>{row.role || 'rider'}{row.is_admin ? ' · admin flag' : ''}{row.standing ? ` · ${row.standing}` : ''}{row.rating_count ? ` · ${row.rating_avg} (${row.rating_count})` : ''}</div>
        </div>
      ))}
    </section>
  )
}

function TripsPanel() {
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  useEffect(() => {
    fetchAdminTrips().then((data) => setRows(data.trips || [])).catch((err) => setError(err.message || String(err)))
  }, [])
  return (
    <section style={{ marginTop: 16 }}>
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {rows.length === 0 && !error && <p style={{ color: 'var(--ink-secondary)' }}>No trips loaded.</p>}
      {rows.map((row) => (
        <div key={row.id} className="sheet" style={{ marginTop: 10, padding: 14, borderRadius: 16 }}>
          <div style={{ fontWeight: 800, color: '#522D80' }}>{row.status}</div>
          <div style={{ fontSize: 13 }}>{row.pickup_label || 'Pickup'} → {row.dropoff_label || 'Drop-off'}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-secondary)', marginTop: 4 }}>
            Rider {row.rider?.full_name || row.rider_id || '—'} · Driver {row.driver?.full_name || row.driver_id || '—'}
            {row.fare_cents != null ? ` · $${(Number(row.fare_cents) / 100).toFixed(2)}` : ''}
          </div>
        </div>
      ))}
    </section>
  )
}

function SupportPanel() {
  const [filter, setFilter] = useState('escalated')
  const [rows, setRows] = useState([])
  const [openId, setOpenId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    const data = await fetchAdminTickets(filter)
    setRows(data.tickets || [])
    if (data.error) setError(data.error)
  }

  useEffect(() => {
    load().catch((err) => setError(err.message || String(err)))
  }, [filter])

  async function open(id) {
    setOpenId(id)
    setDetail(null)
    const data = await fetchAdminTicket(id)
    setDetail(data)
  }

  async function send(status) {
    if (!openId || !draft.trim()) return
    setBusy(true)
    setError('')
    try {
      await replyAdminTicket({ ticketId: openId, body: draft.trim(), status })
      setDraft('')
      await open(openId)
      await load()
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section style={{ marginTop: 16 }}>
      <h2 style={{ fontSize: 18, color: '#522D80' }}>Support inbox</h2>
      <p style={{ fontSize: 13, color: 'var(--ink-secondary)', lineHeight: 1.45 }}>
        The support bot answers account, payment, ride, and driver-application questions. Tickets land here when the bot escalates.
      </p>
      <ChipRow value={filter} onChange={setFilter} options={TICKET_FILTERS} />
      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
      {rows.map((row) => (
        <div key={row.id} className="sheet" style={{ marginTop: 10, padding: 14, borderRadius: 16 }}>
          <button type="button" className="pressable" onClick={() => open(row.id)} style={{ width: '100%', textAlign: 'left' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#F56600' }}>{row.status} · {row.category}</div>
            <div style={{ fontWeight: 800, color: '#522D80' }}>{row.subject}</div>
            {row.escalation_reason && <div style={{ fontSize: 12, color: 'var(--ink-secondary)' }}>{row.escalation_reason}</div>}
          </button>
          {openId === row.id && detail?.ticket && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--ink-secondary)' }}>
                {detail.profile?.full_name || 'Rider'} · {detail.profile?.email}{detail.profile?.phone ? ` · ${detail.profile.phone}` : ''}
              </div>
              <p style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{detail.ticket.body}</p>
              {(detail.messages || []).map((message) => (
                <p key={message.id} style={{ fontSize: 13 }}>
                  <strong style={{ color: message.author_role === 'bot' ? '#F56600' : '#522D80' }}>{message.author_role}</strong>
                  {' · '}{message.body}
                </p>
              ))}
              <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} placeholder="Reply as admin" style={{ width: '100%', borderRadius: 12, padding: 10, marginTop: 8 }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button type="button" className="pressable" disabled={busy} onClick={() => send('waiting_user')} style={actionStyle(false)}>Ask the user</button>
                <button type="button" className="pressable" disabled={busy} onClick={() => send('resolved')} style={actionStyle(true)}>Resolve</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </section>
  )
}

function ChipRow({ value, onChange, options }) {
  return (
    <div style={{ display: 'flex', gap: 8, overflowX: 'auto', marginTop: 8 }}>
      {options.map(([id, label]) => (
        <button
          key={label}
          type="button"
          className="pressable"
          onClick={() => onChange(id)}
          style={{
            flex: '0 0 auto',
            padding: '6px 10px',
            borderRadius: 999,
            fontWeight: 700,
            fontSize: 12,
            color: value === id ? '#fff' : '#522D80',
            background: value === id ? '#522D80' : 'white',
            border: '1px solid rgba(82,45,128,0.15)',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function actionStyle(filled) {
  return {
    padding: '8px 12px',
    borderRadius: 12,
    fontWeight: 800,
    color: filled ? '#fff' : '#522D80',
    background: filled ? '#522D80' : 'white',
    border: '1px solid rgba(82,45,128,0.25)',
  }
}
