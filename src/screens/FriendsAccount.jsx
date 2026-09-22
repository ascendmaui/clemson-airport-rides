import { useEffect, useRef, useState } from 'react'
import { BottomTabs } from '../components/BottomTabs'
import { PrimaryButton } from '../components/PrimaryButton'
import { useAuth } from '../lib/auth'
import { navigate, shareUrl } from '../lib/navigation'
import { createLocationShare, startSharingLocation } from '../lib/locationShare'
import { fetchProfile, updateMyProfile } from '../lib/ratings'
import { supabase } from '../lib/supabase'

const ACTIVE = ['searching', 'offered', 'accepted', 'arriving', 'in_progress']

export function FriendsScreen() {
  const { user } = useAuth()
  const [trip, setTrip] = useState(null)
  const [share, setShare] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)
  const stopRef = useRef(null)

  useEffect(() => () => { stopRef.current?.() }, [])

  useEffect(() => {
    if (!supabase || !user?.id) return undefined
    let alive = true
    async function load() {
      const { data, error: qErr } = await supabase
        .from('trips')
        .select('id, status, pickup_label, dropoff_label, requested_at')
        .eq('rider_id', user.id)
        .in('status', ACTIVE)
        .order('requested_at', { ascending: false })
        .limit(1)
      if (!alive) return
      if (qErr) {
        setError(qErr.message)
        return
      }
      setTrip(data?.[0] || null)
    }
    load()
    const t = setInterval(load, 10000)
    return () => {
      alive = false
      clearInterval(t)
    }
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
      if (navigator.share) {
        try {
          await navigator.share({ title: 'My Clemson RIDES location', url, text: 'Follow my live ride location' })
        } catch {
          /* cancel */
        }
      }
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

  return (
    <div className="route-fade" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div style={{ flex: 1, padding: 24 }}>
        <button
          type="button"
          className="pressable"
          onClick={() => navigate('home')}
          style={{
            fontSize: 20,
            marginBottom: 12,
            width: 44,
            height: 44,
            borderRadius: 14,
            background: 'var(--surface)',
            boxShadow: 'var(--shadow-pill)',
          }}
        >
          ←
        </button>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--purple)', letterSpacing: -0.3 }}>
          Live location share
        </h1>
        <p style={{ color: 'var(--ink-secondary)', marginTop: 8, lineHeight: 1.45 }}>
          Share a live map link with friends or family while your Clemson RIDES trip is active. The link expires when the
          ride completes or is canceled.
        </p>

        <div
          className="card-soft"
          style={{
            marginTop: 20,
            padding: 16,
            borderRadius: 16,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-soft)',
          }}
        >
          {trip ? (
            <>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Active trip</div>
              <div style={{ fontSize: 13, color: 'var(--ink-secondary)', marginBottom: 12, lineHeight: 1.4 }}>
                {trip.pickup_label || 'Pickup'} → {trip.dropoff_label || 'Dropoff'}
                <br />
                Status: {trip.status}
              </div>
              <PrimaryButton onClick={onShare} disabled={busy}>
                {busy ? 'Starting…' : share ? 'Refresh share link' : 'Share my location'}
              </PrimaryButton>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>No active trip</div>
              <div style={{ fontSize: 13, color: 'var(--ink-tertiary)', lineHeight: 1.4, marginBottom: 12 }}>
                Request a ride first. Once you have a booked trip, you can start a live share from here or from the
                Requested screen.
              </div>
              <PrimaryButton onClick={() => navigate('home')}>Book a ride</PrimaryButton>
            </>
          )}

          {link && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-secondary)', marginBottom: 6 }}>
                Public link {copied ? '· copied' : ''}
              </div>
              <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', wordBreak: 'break-all', marginBottom: 10 }}>
                {link}
              </p>
              <button
                type="button"
                className="pressable"
                onClick={() => window.open(link, '_blank', 'noopener,noreferrer')}
                style={{ fontWeight: 600, color: 'var(--purple)' }}
              >
                Open live map →
              </button>
            </div>
          )}

          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Try the demo map</div>
            <button
              type="button"
              className="pressable"
              onClick={() => {
                window.location.assign('/share/demo-live-7de5776128b8')
              }}
              style={{ fontWeight: 600, color: 'var(--purple)' }}
            >
              Open demo live share →
            </button>
          </div>

          {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 12 }}>{error}</p>}
        </div>
      </div>
      <BottomTabs active="friends" onChange={(id) => navigate(id === 'home' ? 'home' : id)} />
    </div>
  )
}

export function AccountScreen() {
  const { user, configured, signOut } = useAuth()
  const displayName =
    user?.user_metadata?.full_name ||
    user?.email?.split('@')[0] ||
    'Rider'
  const [profile, setProfile] = useState(null)
  const [bio, setBio] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    if (!user?.id) return
    fetchProfile(user.id)
      .then((p) => {
        setProfile(p)
        setBio(p?.bio || '')
      })
      .catch(() => {})
  }, [user?.id])

  async function onSignOut() {
    try {
      await signOut()
    } catch {
      /* ignore */
    }
    navigate('landing')
  }

  async function onSaveBio() {
    if (!user?.id) return
    setSaving(true)
    setMsg(null)
    try {
      await updateMyProfile(user.id, { bio: bio.trim() || null, full_name: displayName })
      setMsg('Saved')
      const p = await fetchProfile(user.id)
      setProfile(p)
    } catch (e) {
      setMsg(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const avg = profile?.rating_avg != null ? Number(profile.rating_avg).toFixed(1) : '—'
  const count = profile?.rating_count || 0

  return (
    <div className="route-fade" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div style={{ flex: 1, padding: 24 }}>
        <button
          type="button"
          className="pressable"
          onClick={() => navigate('home')}
          style={{
            fontSize: 20,
            marginBottom: 12,
            width: 44,
            height: 44,
            borderRadius: 14,
            background: 'var(--surface)',
            boxShadow: 'var(--shadow-pill)',
          }}
        >
          ←
        </button>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--purple)', letterSpacing: -0.3 }}>
          {displayName}
        </h1>
        <p style={{ color: 'var(--ink-secondary)', marginTop: 8 }}>Account & profile</p>

        <div
          className="card-soft"
          style={{
            marginTop: 20,
            padding: 16,
            borderRadius: 16,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-soft)',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Your rating</div>
          <div style={{ fontSize: 14, color: 'var(--ink-secondary)', marginBottom: 12 }}>
            ★ {avg} ({count} ratings)
          </div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Bio</div>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            placeholder="Short bio for riders and drivers"
            style={{ width: '100%', padding: 10, borderRadius: 12, border: '1px solid var(--border)', marginBottom: 10 }}
          />
          <button type="button" className="pressable" onClick={onSaveBio} disabled={saving} style={{ fontWeight: 600, color: 'var(--purple)' }}>
            {saving ? 'Saving…' : 'Save profile'}
          </button>
          {msg && <div style={{ fontSize: 12, marginTop: 8, color: 'var(--ink-tertiary)' }}>{msg}</div>}
          {user?.id && (
            <button
              type="button"
              className="pressable"
              onClick={() => navigate('profile', { id: user.id })}
              style={{ display: 'block', marginTop: 12, fontWeight: 600, color: 'var(--purple)' }}
            >
              View public profile →
            </button>
          )}
        </div>

        <div
          className="card-soft"
          style={{
            marginTop: 20,
            padding: 16,
            borderRadius: 16,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            boxShadow: 'var(--shadow-soft)',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Supabase session</div>
          <div style={{ fontSize: 13, color: 'var(--ink-tertiary)', marginBottom: 12 }}>
            {configured ? user?.email || 'Signed in' : 'Set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY'}
          </div>
          <button
            type="button"
            className="pressable"
            onClick={() => navigate('driver')}
            style={{ marginTop: 4, fontWeight: 600, color: 'var(--purple)' }}
          >
            Switch to driver mode →
          </button>
          <button
            type="button"
            className="pressable"
            onClick={() => navigate('landing')}
            style={{ display: 'block', marginTop: 10, fontWeight: 600, color: 'var(--ink-secondary)' }}
          >
            Marketing / download QR
          </button>
          <button
            type="button"
            className="pressable primary-cta"
            onClick={onSignOut}
            style={{
              display: 'block',
              width: '100%',
              marginTop: 18,
              padding: 14,
              borderRadius: 14,
              background: 'linear-gradient(135deg, var(--orange) 0%, #ff7a1a 100%)',
              color: '#fff',
              fontWeight: 700,
              boxShadow: 'var(--shadow-cta)',
            }}
          >
            Sign out
          </button>
        </div>
      </div>
      <BottomTabs active="account" onChange={(id) => navigate(id === 'home' ? 'home' : id)} />
    </div>
  )
}
