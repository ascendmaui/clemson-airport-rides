import { useEffect, useState } from 'react'
import { BottomTabs } from '../components/BottomTabs'
import { useAuth } from '../lib/auth'
import { navigate } from '../lib/navigation'
import { fetchProfile, updateMyProfile } from '../lib/ratings'

export function FriendsScreen() {
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
          Ride with friends
        </h1>
        <p style={{ color: 'var(--ink-secondary)', marginTop: 8, lineHeight: 1.45 }}>
          Split fares and share ETAs with classmates. Friend invites ship next — hang tight, Tigers.
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
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Coming soon</div>
          <div style={{ fontSize: 13, color: 'var(--ink-tertiary)', lineHeight: 1.4 }}>
            Invite links and shared trip cards will appear here once the friends graph is live.
          </div>
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
