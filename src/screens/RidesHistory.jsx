import { useEffect, useState } from 'react'
import { BottomTabs } from '../components/BottomTabs'
import { RequireAuth } from '../components/RequireAuth'
import { useAuth } from '../lib/auth'
import { fetchRecentLostFoundTrips } from '../lib/lostFound'
import { navigate } from '../lib/navigation'

function formatWhen(iso) {
  if (!iso) return 'Completed ride'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Completed ride'
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function HistoryInner() {
  const { user } = useAuth()
  const [trips, setTrips] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user?.id) return undefined
    let alive = true
    fetchRecentLostFoundTrips(user.id)
      .then((rows) => { if (alive) setTrips(rows) })
      .catch((e) => { if (alive) setError(e.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [user?.id])

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div style={{ flex: 1, overflow: 'auto', padding: '20px 20px 96px' }} data-testid="rides-history">
        <button
          type="button"
          className="pressable"
          aria-label="Back"
          onClick={() => navigate('home')}
          style={{
            fontSize: 20, marginBottom: 12, width: 44, height: 44, borderRadius: 14,
            background: 'var(--surface)', boxShadow: 'var(--shadow-pill)',
          }}
        >
          ←
        </button>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--purple)' }}>Your rides</h1>
        <p style={{ color: 'var(--ink-secondary)', marginTop: 6, fontSize: 14, lineHeight: 1.45 }}>
          Recent completed trips. Places are shown as areas, and the other person by first name.
        </p>
        {loading && <p style={{ marginTop: 16, color: 'var(--ink-tertiary)' }}>Loading rides…</p>}
        {error && <p style={{ marginTop: 16, color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
        {!loading && !error && trips.length === 0 && (
          <div className="glass-panel" style={{ marginTop: 16, padding: 16, borderRadius: 18 }}>
            <div style={{ fontWeight: 700 }}>No completed rides yet</div>
            <p style={{ fontSize: 13, color: 'var(--ink-secondary)', marginTop: 6 }}>
              After a trip finishes, you can report a lost item from here.
            </p>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
          {trips.map((t) => (
            <div key={t.id} className="glass-panel" style={{ padding: 14, borderRadius: 16 }}>
              <div style={{ fontWeight: 700 }}>{t.pickup} → {t.dropoff}</div>
              <div style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginTop: 4 }}>
                {formatWhen(t.completedAt)} · {t.otherRole === 'driver' ? 'Driver' : 'Rider'} {t.otherFirstName}
              </div>
              <button
                type="button"
                className="pressable"
                onClick={() => navigate('lost-found', { trip: t.id })}
                style={{ marginTop: 10, fontWeight: 700, color: 'var(--orange)' }}
              >
                Left something in the car?
              </button>
            </div>
          ))}
        </div>
      </div>
      <BottomTabs active="home" onChange={(id) => navigate(id === 'home' ? 'home' : id)} />
    </div>
  )
}

export function RidesHistory() {
  return (
    <RequireAuth>
      <HistoryInner />
    </RequireAuth>
  )
}
