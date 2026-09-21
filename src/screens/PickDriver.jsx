import { useEffect, useState } from 'react'
import { PrimaryButton } from '../components/PrimaryButton'
import { navigate } from '../lib/navigation'
import { fetchOnlineDrivers, subscribeTrips, supabaseConfigured } from '../lib/supabase'
import { requestDriverTrip } from '../lib/trips'
import { useAuth } from '../lib/auth'
import { SignInToBookModal, useRequireAuthForAction } from '../components/SignInToBookModal'

export function PickDriver({ dest = 'GSP Airport' }) {
  const { user } = useAuth()
  const { runOrPrompt } = useRequireAuthForAction()
  const [drivers, setDrivers] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [tripFlash, setTripFlash] = useState(null)
  const [busy, setBusy] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)

  const load = async () => {
    setLoading(true)
    const { drivers: list, error: err } = await fetchOnlineDrivers()
    setDrivers(list)
    setError(err)
    setLoading(false)
  }

  useEffect(() => {
    load()
    const unsub = subscribeTrips((payload) => {
      setTripFlash(`${payload.eventType} · trip ${payload.new?.id || payload.old?.id || ''}`)
      load()
    })
    return unsub
  }, [])

  const onRequest = async () => {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      const trip = await requestDriverTrip({
        riderId: user.id,
        driverId: selected.id,
        dest,
      })
      navigate('requested', { dest, trip: trip.id, driver: selected.name })
    } catch (err) {
      setError(err.message || 'Could not request that driver')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fade-in" style={{ minHeight: '100%', background: 'var(--surface-muted)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 20px 8px' }}>
        <button type="button" className="pressable" onClick={() => navigate('tiers', { dest })} style={{ fontSize: 20 }}>←</button>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginTop: 12 }}>Pick a driver</h1>
        <p style={{ color: 'var(--ink-secondary)', fontSize: 14, marginTop: 6 }}>
          Live from Supabase driver_status where online=true
        </p>
        {tripFlash && (
          <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 12, background: 'var(--purple-soft)', color: 'var(--purple)', fontSize: 12, fontWeight: 600 }}>
            Realtime: {tripFlash}
          </div>
        )}
      </div>

      <div style={{ flex: 1, padding: '8px 16px 24px', overflowY: 'auto' }}>
        {!supabaseConfigured && (
          <p style={{ color: '#b00020', padding: 12 }}>
            Configure VITE_SUPABASE_ANON_KEY — no demo fleet.
          </p>
        )}
        {loading && <p style={{ color: 'var(--ink-secondary)', padding: 12 }}>Loading online drivers…</p>}
        {error && <p style={{ color: '#b00020', padding: 12 }}>{error}</p>}
        {!loading && !error && drivers.length === 0 && (
          <div className="sheet" style={{ padding: 24, borderRadius: 20, textAlign: 'center', boxShadow: 'var(--shadow-pill)' }}>
            <p style={{ fontWeight: 600, marginBottom: 8 }}>No drivers available</p>
            <p style={{ fontSize: 13, color: 'var(--ink-secondary)' }}>
              When a driver goes online in Driver mode, they show up here.
            </p>
          </div>
        )}

        {drivers.map((d) => {
          const active = selected?.id === d.id
          return (
            <button
              key={d.id}
              type="button"
              className="pressable"
              onClick={() => setSelected(d)}
              style={{
                width: '100%',
                textAlign: 'left',
                marginBottom: 10,
                padding: 16,
                borderRadius: 16,
                background: active ? 'var(--orange-soft)' : 'var(--surface)',
                border: `1.5px solid ${active ? 'rgba(245,102,0,0.45)' : 'var(--border)'}`,
                boxShadow: 'var(--shadow-pill)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{d.name}</div>
                  <div style={{ fontSize: 13, color: 'var(--ink-secondary)', marginTop: 4 }}>
                    {d.vehicleLabel}{d.plate ? ` · ${d.plate}` : ''}
                  </div>
                  {d.isTesla && (
                    <span style={{ display: 'inline-block', marginTop: 8, fontSize: 11, fontWeight: 700, color: 'var(--purple)', background: 'var(--purple-soft)', padding: '4px 8px', borderRadius: 999 }}>
                      TESLA
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-secondary)', textAlign: 'right' }}>
                  {d.priorityMode ? 'Priority' : 'Standard'}
                  <div style={{ marginTop: 4, color: '#1a7f37', fontWeight: 600 }}>Online</div>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <div style={{ padding: '12px 20px calc(20px + var(--safe-bottom))' }}>
        <PrimaryButton
          disabled={!selected || busy}
          onClick={() => runOrPrompt(onRequest, { setPromptOpen, nextPath: 'pick-driver', nextParams: { dest } })}
        >
          {busy ? 'Requesting…' : selected ? `Request ${selected.name}` : 'Select a driver'}
        </PrimaryButton>
      </div>
      <SignInToBookModal open={promptOpen} onClose={() => setPromptOpen(false)} nextPath="pick-driver" nextParams={{ dest }} />
    </div>
  )
}
