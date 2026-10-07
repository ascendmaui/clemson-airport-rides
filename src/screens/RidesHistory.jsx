import { useEffect, useState } from 'react'
import { BottomTabs } from '../components/BottomTabs'
import { RequireAuth } from '../components/RequireAuth'
import { useAuth } from '../lib/auth'
import { fetchRecentLostFoundTrips } from '../lib/lostFound'
import { ReportLostItemButton } from '../components/ReportLostItem'
import { SkeletonRideCard } from '../components/LoadingSkeleton'
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
        {loading && (
          <div style={{ marginTop: 16 }}>
            <SkeletonRideCard count={2} />
          </div>
        )}
        {error && <p style={{ marginTop: 16, color: 'var(--danger)', fontSize: 13 }}>{error}</p>}
        {!loading && !error && trips.length === 0 && (
          <div
            className="glass-panel"
            role="status"
            aria-live="polite"
            style={{
              marginTop: 16,
              padding: 20,
              borderRadius: 18,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 8 }} aria-hidden="true">🚗</div>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--ink)' }}>No completed rides yet</div>
            <p style={{ fontSize: 13, color: 'var(--ink-secondary)', marginTop: 6, lineHeight: 1.45 }}>
              After a trip finishes, your route summary, receipt, and lost & found reporting will appear here.
            </p>
            <button
              type="button"
              className="pressable primary-cta"
              onClick={() => navigate('home')}
              style={{
                marginTop: 14,
                padding: '10px 18px',
                borderRadius: 14,
                background: 'linear-gradient(135deg, #F56600 0%, #ff7a1a 100%)',
                color: '#fff',
                fontWeight: 700,
                fontSize: 14,
                border: 'none',
                boxShadow: 'var(--shadow-pill)',
              }}
            >
              Book your first ride
            </button>
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
              <ReportLostItemButton
                trip={{
                  id: t.id,
                  status: 'completed',
                  completed_at: t.completedAt,
                  rider_id: t.otherRole === 'driver' ? user.id : t.otherId,
                  driver_id: t.otherRole === 'rider' ? user.id : t.otherId,
                }}
                userId={user.id}
                onOpened={() => navigate('requested', { trip: t.id })}
              />
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
