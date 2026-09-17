import { BottomTabs } from '../components/BottomTabs'
import { useAuth } from '../lib/auth'
import { navigate } from '../lib/navigation'

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
  const { user, signOut, configured } = useAuth()
  const displayName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    (user?.email ? user.email.split('@')[0] : 'Tiger rider')

  async function onSignOut() {
    try {
      await signOut()
    } catch (err) {
      console.warn('[account] signOut', err)
    }
    navigate('sign-in')
  }

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
          Account
        </h1>
        <p style={{ color: 'var(--ink-secondary)', marginTop: 8 }}>
          Welcome, {displayName}
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
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Supabase session</div>
          <div style={{ fontSize: 13, color: 'var(--ink-tertiary)', marginBottom: 12 }}>
            {configured
              ? user?.email || 'Signed in'
              : 'Set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY'}
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
