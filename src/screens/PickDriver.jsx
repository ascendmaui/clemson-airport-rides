import { useEffect, useState } from 'react'
import { PrimaryButton } from '../components/PrimaryButton'
import { navigate } from '../lib/navigation'
import { subscribeTrips, supabase, supabaseConfigured } from '../lib/supabase'
import { requestDriverTrip } from '../lib/trips'
import { useAuth } from '../lib/auth'
import { useStudentStatus } from '../lib/useStudentStatus'
import { STUDENT_DISCOUNT_LABEL } from '../../packages/rides-native/riderMoney.js'
import { pickupPoint } from '../../packages/rides-native/places.js'
import {
  describeDriver,
  fetchDriversByIds,
  fetchOnlineDrivers,
  groupDriversForPicker,
  loadFavoriteDriverIds,
  PREFERRED_MATCH_COPY,
  PREFERRED_OFFLINE_COPY,
  saveFavoriteDriverIds,
  sortPreferredDrivers,
} from '../../packages/rides-native/drivers.js'
import { SignInToBookModal, useRequireAuthForAction } from '../components/SignInToBookModal'
import { teslaFleetNotice } from '../../packages/rides-native/tripTags.js'

const browserStorage = {
  async getItem(key) {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  async setItem(key, value) {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* private mode */
    }
  },
}

export function PickDriver({ dest = 'GSP Airport', tier = 'standard', listCents = '' }) {
  const { user } = useAuth()
  const student = useStudentStatus()
  const { runOrPrompt } = useRequireAuthForAction()
  const [drivers, setDrivers] = useState([])
  const [favoriteIds, setFavoriteIds] = useState([])
  const [favNote, setFavNote] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [tripFlash, setTripFlash] = useState(null)
  const [busy, setBusy] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)
  const pickup = pickupPoint('Memorial Stadium')
  const approachPickup = { lat: pickup.latitude, lng: pickup.longitude }

  const load = async () => {
    setLoading(true)
    const [{ drivers: online, error: err }, fav] = await Promise.all([
      fetchOnlineDrivers(supabase),
      user?.id
        ? loadFavoriteDriverIds(supabase, browserStorage, user.id)
        : Promise.resolve({ ids: [], note: null }),
    ])
    const extraIds = fav.ids.filter((id) => !online.some((driver) => driver.id === id))
    const extra = extraIds.length
      ? await fetchDriversByIds(supabase, extraIds)
      : { drivers: [], error: null }
    const merged = sortPreferredDrivers([...online, ...extra.drivers], fav.ids, approachPickup)
    setDrivers(merged)
    setSelected((current) => merged.find((driver) => driver.id === current?.id) || null)
    setFavoriteIds(fav.ids)
    setFavNote(fav.note)
    setError(extra.error || err)
    setLoading(false)
  }

  useEffect(() => {
    load()
    const unsub = subscribeTrips((payload) => {
      setTripFlash(`${payload.eventType} · trip ${payload.new?.id || payload.old?.id || ''}`)
      load()
    })
    return unsub
  }, [user?.id])

  const toggleFavorite = async (driverId) => {
    if (!user?.id) {
      setPromptOpen(true)
      return
    }
    const next = favoriteIds.includes(driverId)
      ? favoriteIds.filter((id) => id !== driverId)
      : [...favoriteIds, driverId]
    setFavoriteIds(next)
    const saved = await saveFavoriteDriverIds(supabase, browserStorage, user.id, next)
    setFavoriteIds(saved.ids)
    setFavNote(saved.note)
  }

  const onRequest = async () => {
    if (!selected) return
    if (!selected.online) {
      setError('That driver is offline. This request does not auto-match.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const trip = await requestDriverTrip({
        riderId: user.id,
        driverId: selected.id,
        dest,
        tier,
        isStudent: student.verified,
        listCents,
      })
      navigate('requested', { dest, trip: trip.id, driver: selected.name })
    } catch (err) {
      setError(err.message || 'Could not request that driver')
    } finally {
      setBusy(false)
    }
  }

  const teslaNotice = teslaFleetNotice(tier === 'tesla' || tier === 'tesla_self_driving' || Boolean(selected?.isTesla))
  const groups = groupDriversForPicker(sortPreferredDrivers(drivers, favoriteIds, approachPickup), favoriteIds)
  const anyOnline = drivers.some((driver) => driver.online)
  const sections = [
    groups.preferred.length ? ['Preferred', groups.preferred] : null,
    groups.online.length ? ['Online now', groups.online] : null,
  ].filter(Boolean)

  return (
    <div className="fade-in" style={{ minHeight: '100%', background: 'var(--surface-muted)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 20px 8px' }}>
        <button type="button" className="pressable" onClick={() => navigate('tiers', { dest })} style={{ fontSize: 20 }}>←</button>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginTop: 12 }}>Pick a driver</h1>
        <p style={{ color: 'var(--ink-secondary)', fontSize: 14, marginTop: 6, lineHeight: 1.45 }}>
          {PREFERRED_MATCH_COPY}
        </p>
        {tripFlash && (
          <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 12, background: 'var(--purple-soft)', color: 'var(--purple)', fontSize: 12, fontWeight: 600 }}>
            Realtime: {tripFlash}
          </div>
        )}
        {favNote && (
          <p style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: 'var(--purple)' }}>{favNote}</p>
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
        {!loading && !anyOnline && (
          <div className="sheet" style={{ padding: 24, borderRadius: 20, textAlign: 'center', boxShadow: 'var(--shadow-pill)', marginBottom: 12 }}>
            <p style={{ fontWeight: 700, marginBottom: 8 }}>{drivers.length ? 'Preferred drivers are offline' : 'No drivers available'}</p>
            <p style={{ fontSize: 13, color: 'var(--ink-secondary)', lineHeight: 1.45 }}>
              {drivers.length
                ? PREFERRED_OFFLINE_COPY
                : 'When a driver goes online in Driver mode, they show up here. This screen does not auto-match.'}
            </p>
          </div>
        )}

        {sections.map(([title, rows]) => (
          <div key={title} style={{ marginBottom: 8 }}>
            {sections.length > 1 && (
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.6, color: 'var(--purple)', margin: '8px 4px' }}>{title.toUpperCase()}</div>
            )}
            {rows.map((d) => {
              const active = selected?.id === d.id
              const saved = favoriteIds.includes(d.id)
              const lines = describeDriver(d, approachPickup)
              const eta = d.online
                ? [lines.etaLabel, lines.distanceLabel ? `${lines.distanceLabel} from pickup` : null].filter(Boolean).join(' · ') || 'ETA unavailable'
                : 'Not available now'
              return (
                <div
                  key={d.id}
                  className="pressable"
                  onClick={() => setSelected(d)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') setSelected(d)
                  }}
                  role="button"
                  tabIndex={0}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    marginBottom: 10,
                    padding: 16,
                    borderRadius: 16,
                    background: active ? 'var(--orange-soft)' : 'var(--surface)',
                    border: `1.5px solid ${active ? 'rgba(245,102,0,0.45)' : 'var(--border)'}`,
                    boxShadow: 'var(--shadow-pill)',
                    opacity: d.online ? 1 : 0.72,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>
                        {d.name}
                        <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--purple)' }}>
                          ★ {lines.ratingLabel}
                        </span>
                      </div>
                      {d.standing === 'watch' && (
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--orange)', marginTop: 2 }}>Low rating</div>
                      )}
                      <div style={{ fontSize: 13, color: 'var(--ink-secondary)', marginTop: 4 }}>
                        {d.vehicleLabel}{d.plate ? ` · ${d.plate}` : ''}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--purple)', marginTop: 6, fontWeight: 700 }}>{eta}</div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                        {saved && (
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--purple)', background: 'var(--purple-soft)', padding: '4px 8px', borderRadius: 999 }}>
                            Preferred
                          </span>
                        )}
                        {d.isTesla && (
                          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--purple)', background: 'var(--purple-soft)', padding: '4px 8px', borderRadius: 999 }}>
                            TESLA
                          </span>
                        )}
                        <button
                          type="button"
                          className="pressable"
                          onClick={(event) => {
                            event.stopPropagation()
                            toggleFavorite(d.id)
                          }}
                          style={{ fontSize: 12, fontWeight: 800, color: saved ? '#fff' : 'var(--orange)', background: saved ? 'var(--purple)' : 'transparent', borderRadius: 999, padding: '4px 10px' }}
                        >
                          {saved ? 'Saved' : 'Save'}
                        </button>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-secondary)', textAlign: 'right' }}>
                      <div style={{ color: d.online ? '#F56600' : 'var(--ink-secondary)', fontWeight: 800, fontSize: 16 }}>
                        {d.online ? (lines.etaLabel || 'No ETA') : 'Offline'}
                      </div>
                      <div style={{ marginTop: 4, color: d.online ? '#1a7f37' : 'var(--ink-tertiary)', fontWeight: 600 }}>{lines.availability}</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div style={{ padding: '12px 20px calc(20px + var(--safe-bottom))' }}>
        {teslaNotice ? (
          <p style={{ fontSize: 13, lineHeight: 1.4, color: '#522D80', fontWeight: 650, marginBottom: 8 }}>
            {teslaNotice}
          </p>
        ) : null}
        {student.verified && tier === 'standard' ? (
          <p style={{ fontSize: 13, fontWeight: 800, color: '#F56600', marginBottom: 8 }}>
            {STUDENT_DISCOUNT_LABEL} is on this request.
          </p>
        ) : null}
        {student.verified && tier !== 'standard' ? (
          <p style={{ fontSize: 13, fontWeight: 700, color: '#522D80', marginBottom: 8 }}>
            Student pricing is 10% off Standard. This tier stays full price.
          </p>
        ) : null}
        <PrimaryButton
          disabled={!selected?.online || busy}
          onClick={() => runOrPrompt(onRequest, { setPromptOpen, nextPath: 'pick-driver', nextParams: { dest } })}
        >
          {busy ? 'Requesting…' : selected ? `Request ${selected.name}` : 'Select a driver'}
        </PrimaryButton>
      </div>
      <SignInToBookModal open={promptOpen} onClose={() => setPromptOpen(false)} nextPath="pick-driver" nextParams={{ dest }} />
    </div>
  )
}
