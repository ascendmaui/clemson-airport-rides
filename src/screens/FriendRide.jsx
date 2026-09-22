import { useCallback, useEffect, useMemo, useState } from 'react'
import { CampusMap, CLEMSON } from '../components/CampusMap'
import { PrimaryButton } from '../components/PrimaryButton'
import { BottomTabs } from '../components/BottomTabs'
import { useAuth } from '../lib/auth'
import { navigate } from '../lib/navigation'
import { formatUsdFromCents } from '../lib/pricing'
import {
  FRIEND_PLACES, confirmFriendCharges, createFriendRide, decodePolyline,
  formatEta, formatMiles, friendsUrl, getFriendRide, joinFriendRide, recomputeFriendRide,
} from '../lib/friendRides'

const card = {
  marginTop: 16, padding: 16, borderRadius: 16, background: 'var(--surface)',
  border: '1px solid var(--border)', boxShadow: 'var(--shadow-soft)',
}

function PlaceSelect({ label, value, onChange }) {
  return (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-secondary)', marginBottom: 4 }}>{label}</div>
      <select
        value={value?.label || ''}
        onChange={(e) => onChange(FRIEND_PLACES.find((x) => x.label === e.target.value) || null)}
        style={{ width: '100%', padding: 12, borderRadius: 12, border: '1px solid var(--border)', background: '#fff' }}
      >
        <option value="">Select place…</option>
        {FRIEND_PLACES.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
      </select>
    </label>
  )
}

export function FriendRideScreen({ token: tokenProp }) {
  const { user } = useAuth()
  const [token, setToken] = useState(tokenProp || '')
  const [ride, setRide] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [pickup, setPickup] = useState(FRIEND_PLACES[0])
  const [dropoff, setDropoff] = useState(FRIEND_PLACES[4])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [splitMode, setSplitMode] = useState('even')
  const [mapsHint, setMapsHint] = useState(null)

  useEffect(() => { if (tokenProp) setToken(tokenProp) }, [tokenProp])
  useEffect(() => {
    if (user) {
      setName(user.user_metadata?.full_name || user.email?.split('@')[0] || '')
      setEmail(user.email || '')
    }
  }, [user])

  const refresh = useCallback(async () => {
    if (!token) return
    try {
      setRide(await getFriendRide(token))
      setError(null)
    } catch (e) { setError(e.message) }
  }, [token])

  useEffect(() => {
    refresh()
    if (!token) return undefined
    const t = setInterval(refresh, 8000)
    return () => clearInterval(t)
  }, [refresh, token])

  const routePath = useMemo(() => decodePolyline(ride?.route_polyline), [ride?.route_polyline])
  const mapCenter = ride?.stops?.[0] ? [ride.stops[0].lat, ride.stops[0].lng] : CLEMSON

  async function onCreate() {
    if (!user) { navigate('sign-in'); return }
    setBusy(true); setError(null)
    try {
      const data = await createFriendRide({ displayName: name || 'Organizer', pickup, dropoff, splitMode })
      const t = data.token
      setToken(t)
      window.history.replaceState({}, '', `/friends/${encodeURIComponent(t)}`)
      try { await recomputeFriendRide(t, splitMode) } catch (e) { setMapsHint(e.payload?.message || e.message) }
      setRide(await getFriendRide(t))
    } catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }

  async function onJoin() {
    if (!token) return
    setBusy(true); setError(null)
    try {
      await joinFriendRide({ token, displayName: name || 'Friend', email: email || undefined, pickup, dropoff })
      try { await recomputeFriendRide(token, splitMode); setMapsHint(null) }
      catch (e) { setMapsHint(e.payload?.message || e.message) }
      await refresh()
    } catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }

  async function onRecompute() {
    setBusy(true); setError(null)
    try {
      setRide(await recomputeFriendRide(token, splitMode))
      setMapsHint(null)
    } catch (e) {
      setMapsHint(e.payload?.message || e.message)
      setError(e.message)
    } finally { setBusy(false) }
  }

  async function onConfirmCharges() {
    setBusy(true); setError(null)
    try {
      const data = await confirmFriendCharges(token)
      setRide(data.ride)
      if (data.booked) setMapsHint(`Booked trip ${data.trip?.id} — searching for a driver.`)
    } catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }

  async function onCopy() {
    const url = friendsUrl(token)
    try {
      await navigator.clipboard?.writeText(url)
      await navigator.share?.({ title: 'Ride with friends', url }).catch(() => {})
    } catch {}
  }

  if (!token) {
    return (
      <div className="route-fade" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
        <div style={{ flex: 1, padding: 24, paddingBottom: 96 }}>
          <button type="button" className="pressable" onClick={() => navigate('friends')}
            style={{ fontSize: 20, marginBottom: 12, width: 44, height: 44, borderRadius: 14, background: 'var(--surface)', boxShadow: 'var(--shadow-pill)' }}>←</button>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--purple)' }}>Ride with friends</h1>
          <p style={{ color: 'var(--ink-secondary)', marginTop: 8, lineHeight: 1.45 }}>
            Invite up to 4 friends (5 total). Optimize multi-stop route, split fare, auto-charge.
          </p>
          <div style={card}>
            <label style={{ display: 'block', marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Your name</div>
              <input value={name} onChange={(e) => setName(e.target.value)}
                style={{ width: '100%', padding: 12, borderRadius: 12, border: '1px solid var(--border)' }} />
            </label>
            <PlaceSelect label="Your pickup" value={pickup} onChange={setPickup} />
            <PlaceSelect label="Your dropoff" value={dropoff} onChange={setDropoff} />
            <div style={{ marginBottom: 12 }}>
              <label style={{ marginRight: 16 }}>
                <input type="radio" checked={splitMode === 'even'} onChange={() => setSplitMode('even')} /> Even
              </label>
              <label>
                <input type="radio" checked={splitMode === 'by_distance'} onChange={() => setSplitMode('by_distance')} /> By distance
              </label>
            </div>
            <PrimaryButton onClick={onCreate} disabled={busy}>{busy ? 'Creating…' : 'Create invite link'}</PrimaryButton>
            {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 10 }}>{error}</p>}
          </div>
        </div>
        <BottomTabs active="friends" onChange={(id) => navigate(id === 'home' ? 'home' : id)} />
      </div>
    )
  }

  const isOrganizer = ride?.is_organizer

  return (
    <div className="route-fade" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div style={{ flex: 1, padding: 24, paddingBottom: 96, overflow: 'auto' }}>
        <button type="button" className="pressable" onClick={() => navigate('friends')}
          style={{ fontSize: 20, marginBottom: 12, width: 44, height: 44, borderRadius: 14, background: 'var(--surface)', boxShadow: 'var(--shadow-pill)' }}>←</button>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--purple)' }}>
          {isOrganizer ? 'Friend ride lobby' : 'Join friend ride'}
        </h1>
        <p style={{ fontSize: 13, color: 'var(--ink-tertiary)', marginTop: 4 }}>Status: {ride?.status || '…'}</p>

        <div style={{ marginTop: 12, borderRadius: 16, overflow: 'hidden' }}>
          <CampusMap height={200} interactive center={mapCenter} zoom={routePath ? 11 : 14} route={routePath} marker={mapCenter} />
        </div>

        {(ride?.distance_m || ride?.total_fare_cents) && (
          <div style={{ ...card, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <div><div style={{ fontSize: 11, color: 'var(--ink-tertiary)' }}>Distance</div><div style={{ fontWeight: 700 }}>{formatMiles(ride.distance_m)}</div></div>
            <div><div style={{ fontSize: 11, color: 'var(--ink-tertiary)' }}>ETA</div><div style={{ fontWeight: 700 }}>{formatEta(ride.duration_s)}</div></div>
            <div><div style={{ fontSize: 11, color: 'var(--ink-tertiary)' }}>Total</div><div style={{ fontWeight: 700 }}>{formatUsdFromCents(ride.total_fare_cents)}</div></div>
          </div>
        )}

        {mapsHint && <p style={{ fontSize: 12, color: 'var(--orange)', marginTop: 10 }}>{mapsHint}</p>}

        <div style={card}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Invite link</div>
          <p style={{ fontSize: 12, wordBreak: 'break-all', color: 'var(--ink-secondary)' }}>{friendsUrl(token)}</p>
          <button type="button" className="pressable" onClick={onCopy} style={{ marginTop: 8, fontWeight: 600, color: 'var(--purple)' }}>Copy / share →</button>
        </div>

        {ride?.total_fare_cents != null && (ride?.participants || []).length > 0 && (
          <div style={card}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Fare split preview</div>
            <div style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginBottom: 10 }}>
              Automatic · {ride.split_mode === 'by_distance' ? 'by distance' : 'even'}
            </div>
            {(ride.participants || []).map((p) => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                <span>{p.display_name} · {p.status}</span>
                <span style={{ fontWeight: 700 }}>{p.fare_cents != null ? formatUsdFromCents(p.fare_cents) : '—'}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontWeight: 700 }}>
              <span>Total</span><span>{formatUsdFromCents(ride.total_fare_cents)}</span>
            </div>
          </div>
        )}

        <div style={card}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Participants ({ride?.participants?.length || 0}/5)</div>
          {(ride?.participants || []).map((p) => (
            <div key={p.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
              <strong>{p.display_name}</strong> · {p.status}
              <div style={{ fontSize: 11, color: 'var(--ink-tertiary)' }}>
                {p.pickup?.label || '—'} → {p.dropoff?.label || '—'}
              </div>
            </div>
          ))}
        </div>

        <div style={card}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>{isOrganizer ? 'Update stops' : 'Add your stops'}</div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name"
            style={{ width: '100%', padding: 12, borderRadius: 12, border: '1px solid var(--border)', marginBottom: 10 }} />
          {!user && (
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email"
              style={{ width: '100%', padding: 12, borderRadius: 12, border: '1px solid var(--border)', marginBottom: 10 }} />
          )}
          <PlaceSelect label="Pickup" value={pickup} onChange={setPickup} />
          <PlaceSelect label="Dropoff" value={dropoff} onChange={setDropoff} />
          <PrimaryButton onClick={onJoin} disabled={busy}>{busy ? 'Saving…' : 'Save stops'}</PrimaryButton>
        </div>

        {isOrganizer && (
          <div style={card}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Organizer</div>
            <label style={{ marginRight: 16 }}>
              <input type="radio" checked={splitMode === 'even'} onChange={() => setSplitMode('even')} /> Even
            </label>
            <label>
              <input type="radio" checked={splitMode === 'by_distance'} onChange={() => setSplitMode('by_distance')} /> By distance
            </label>
            <div style={{ height: 10 }} />
            <PrimaryButton onClick={onRecompute} disabled={busy}>Optimize route & fares</PrimaryButton>
            <div style={{ height: 10 }} />
            <PrimaryButton onClick={onConfirmCharges} disabled={busy || ride?.status === 'booked'}>
              {ride?.status === 'booked' ? 'Booked' : 'Confirm & charge friends'}
            </PrimaryButton>
            <p style={{ fontSize: 11, color: 'var(--ink-tertiary)', marginTop: 8 }}>
              Full share · saved card off-session or Apple Pay / Payment Element. Books when all Paid.
            </p>
          </div>
        )}

        {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 12 }}>{error}</p>}
        {ride?.trip_id && (
          <div style={card}>
            <div style={{ fontWeight: 700 }}>Driver searching</div>
            <button type="button" className="pressable" onClick={() => navigate('requested', { trip: ride.trip_id })}
              style={{ marginTop: 8, fontWeight: 600, color: 'var(--purple)' }}>Open trip →</button>
          </div>
        )}
      </div>
      <BottomTabs active="friends" onChange={(id) => navigate(id === 'home' ? 'home' : id)} />
    </div>
  )
}
