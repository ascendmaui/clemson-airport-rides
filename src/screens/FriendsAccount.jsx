import { useEffect, useRef, useState } from 'react'
import { BottomTabs } from '../components/BottomTabs'
import { PrimaryButton } from '../components/PrimaryButton'
import { useAuth } from '../lib/auth'
import { navigate, shareUrl } from '../lib/navigation'
import { createLocationShare, startSharingLocation } from '../lib/locationShare'
import { fetchProfile, updateMyProfile } from '../lib/ratings'
import { supabase } from '../lib/supabase'

const ACTIVE = ['searching', 'offered', 'accepted', 'arriving', 'arrived', 'in_progress']

export function FriendsScreen() {
  const { user } = useAuth()
  const [trip, setTrip] = useState(null)
  const [share, setShare] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)
  const [myRides, setMyRides] = useState([])
  const stopRef = useRef(null)

  useEffect(() => () => { stopRef.current?.() }, [])

  useEffect(() => {
    if (!supabase || !user?.id) return undefined
    let alive = true
    ;(async () => {
      const { data, error: qErr } = await supabase
        .from('trips')
        .select('id, status, pickup_label, dropoff_label, requested_at')
        .eq('rider_id', user.id)
        .in('status', ACTIVE)
        .order('requested_at', { ascending: false })
        .limit(1)
      if (!alive) return
      if (qErr) setError(qErr.message)
      else setTrip(data?.[0] || null)
    })()
    const t = setInterval(() => {
      supabase
        .from('trips')
        .select('id, status, pickup_label, dropoff_label, requested_at')
        .eq('rider_id', user.id)
        .in('status', ACTIVE)
        .order('requested_at', { ascending: false })
        .limit(1)
        .then(({ data }) => alive && setTrip(data?.[0] || null))
    }, 10000)
    return () => { alive = false; clearInterval(t) }
  }, [user?.id])

  useEffect(() => {
    if (!supabase || !user?.id) return undefined
    let alive = true
    supabase
      .from('friend_rides')
      .select('id, token, status, kind, total_fare_cents, created_at, trip_id')
      .eq('organizer_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5)
      .then(({ data }) => alive && setMyRides(data || []))
    return () => { alive = false }
  }, [user?.id])

  async function onShare() {
    if (!trip?.id || !user?.id) {
      setError('Book a ride first, then share your live location from here.')
      return
    }
    setBusy(true)
    setError(null)
    setCopied(false)
    try {
      const s = await createLocationShare(trip.id, user.id)
      setShare(s)
      stopRef.current?.()
      stopRef.current = startSharingLocation({
        shareId: s.id,
        tripId: trip.id,
        onError: (e) => setError(e.message || 'GPS error'),
      })
      const url = s.url || shareUrl(s.token)
      try { await navigator.share?.({ title: 'My Clemson RIDES location', url, text: 'Follow my live ride' }) } catch {}
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
        setCopied(true)
      }
    } catch (e) {
      setError(e.message || 'Could not start share')
    } finally {
      setBusy(false)
    }
  }

  const link = share?.token ? shareUrl(share.token) : null
  const backBtn = {
    fontSize: 20, marginBottom: 12, width: 44, height: 44, borderRadius: 14,
    background: 'var(--surface)', boxShadow: 'var(--shadow-pill)',
  }
  const card = {
    marginTop: 16, padding: 16, borderRadius: 16, background: 'var(--surface)',
    border: '1px solid var(--border)', boxShadow: 'var(--shadow-soft)',
  }

  return (
    <div className="route-fade" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div style={{ flex: 1, padding: 24, overflow: 'auto', paddingBottom: 96 }}>
        <button type="button" className="pressable" onClick={() => navigate('home')} style={backBtn}>←</button>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--purple)' }}>Friends</h1>
        <p style={{ color: 'var(--ink-secondary)', marginTop: 8, lineHeight: 1.45 }}>
          Ride together or share live location on an active trip.
        </p>

        <div className="card-soft" style={{
          ...card, marginTop: 20,
          background: 'linear-gradient(135deg, rgba(245,102,0,0.12), rgba(82,45,128,0.14))',
        }}>
          <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--purple)', marginBottom: 6 }}>
            Ride with friends
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-secondary)', lineHeight: 1.45, marginBottom: 12 }}>
            Create a multi-stop group ride (max 5). Friends add pickups/dropoffs, we optimize the route,
            split the fare, and auto-charge saved cards or Apple Pay. One driver for everyone.
          </div>
          <PrimaryButton onClick={() => navigate('friend-ride')}>Start group ride</PrimaryButton>
          <button
            type="button"
            className="pressable"
            onClick={() => navigate('carpool')}
            style={{ display: 'block', width: '100%', marginTop: 10, padding: 12, borderRadius: 12, fontWeight: 700, color: 'var(--purple)', border: '1.5px solid rgba(82,45,128,0.35)', background: 'rgba(255,255,255,0.55)' }}
          >
            Offer a carpool →
          </button>
          {myRides.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-secondary)', marginBottom: 6 }}>
                Your recent group rides
              </div>
              {myRides.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="pressable"
                  onClick={() => navigate(`${r.kind === 'carpool' ? 'carpool' : 'friends'}/${r.token}`)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}
                >
                  <span style={{ fontWeight: 600 }}>{r.kind === 'carpool' ? 'carpool' : 'friends'} · {r.status}</span>
                  <span style={{ color: 'var(--ink-tertiary)' }}> · {r.token.slice(0, 8)}…</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--purple)', marginTop: 28 }}>
          Live location share
        </h2>
        <p style={{ color: 'var(--ink-secondary)', marginTop: 6, lineHeight: 1.45, fontSize: 14 }}>
          Share a live map link while your trip is active.
        </p>
        <div className="card-soft" style={card}>
          {trip ? (
            <>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Active trip</div>
              <div style={{ fontSize: 13, color: 'var(--ink-secondary)', marginBottom: 12, lineHeight: 1.4 }}>
                {trip.pickup_label || 'Pickup'} → {trip.dropoff_label || 'Dropoff'}
                <br />Status: {trip.status}
              </div>
              <PrimaryButton onClick={onShare} disabled={busy}>
                {busy ? 'Starting…' : share ? 'Refresh share link' : 'Share my location'}
              </PrimaryButton>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>No active trip</div>
              <div style={{ fontSize: 13, color: 'var(--ink-tertiary)', lineHeight: 1.4, marginBottom: 12 }}>
                Request a ride first, then share live location from here.
              </div>
              <PrimaryButton onClick={() => navigate('home')}>Book a ride</PrimaryButton>
            </>
          )}
          {link && (
            <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', wordBreak: 'break-all', marginTop: 12 }}>
              {copied ? 'Copied · ' : ''}{link}
            </p>
          )}
          <button
            type="button"
            className="pressable"
            onClick={() => window.location.assign('/share/demo-live-7de5776128b8')}
            style={{ display: 'block', marginTop: 14, fontWeight: 600, color: 'var(--purple)' }}
          >
            Open demo live share →
          </button>
          {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 12 }}>{error}</p>}
        </div>
      </div>
      <BottomTabs active="friends" onChange={(id) => navigate(id === 'home' ? 'home' : id)} />
    </div>
  )
}

export { AccountScreen } from './AccountScreen'
