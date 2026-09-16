import { BottomTabs } from '../components/BottomTabs'
import { navigate } from '../lib/navigation'

export function FriendsScreen() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div style={{ flex: 1, padding: 24 }}>
        <button type="button" onClick={() => navigate('home')} style={{ fontSize: 20, marginBottom: 12 }}>←</button>
        <h1 style={{ fontSize: 24, fontWeight: 600 }}>Ride with friends</h1>
        <p style={{ color: 'var(--ink-secondary)', marginTop: 8, lineHeight: 1.4 }}>
          Split fares and share ETAs with classmates. Friend graph + invites stubbed for Phase B.
        </p>
      </div>
      <BottomTabs active="friends" onChange={(id) => navigate(id === 'home' ? 'home' : id)} />
    </div>
  )
}

export function AccountScreen() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div style={{ flex: 1, padding: 24 }}>
        <button type="button" onClick={() => navigate('home')} style={{ fontSize: 20, marginBottom: 12 }}>←</button>
        <h1 style={{ fontSize: 24, fontWeight: 600 }}>Account</h1>
        <p style={{ color: 'var(--ink-secondary)', marginTop: 8 }}>Welcome, John · Tiger rider</p>
        <div
          style={{
            marginTop: 20,
            padding: 16,
            borderRadius: 16,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Supabase auth</div>
          <div style={{ fontSize: 13, color: 'var(--ink-tertiary)' }}>
            Real sign-in stubbed. Client wired when VITE_SUPABASE_ANON_KEY is set.
          </div>
          <button
            type="button"
            onClick={() => navigate('driver')}
            style={{ marginTop: 14, fontWeight: 600, color: 'var(--purple)' }}
          >
            Switch to driver mode →
          </button>
          <button
            type="button"
            onClick={() => navigate('landing')}
            style={{ display: 'block', marginTop: 10, fontWeight: 600, color: 'var(--ink-secondary)' }}
          >
            Marketing / download QR
          </button>
        </div>
      </div>
      <BottomTabs active="account" onChange={(id) => navigate(id === 'home' ? 'home' : id)} />
    </div>
  )
}
