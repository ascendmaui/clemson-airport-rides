import { useAuth } from '../lib/auth'
import { getHashRoute, navigate } from '../lib/navigation'

export function RequireAuth({ children }) {
  const { session, loading, configured } = useAuth()

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-secondary)' }}>
        Loading…
      </div>
    )
  }

  if (!configured) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <p style={{ color: 'var(--danger)', fontWeight: 600, marginBottom: 8 }}>Supabase not configured</p>
        <p style={{ color: 'var(--ink-secondary)', fontSize: 14 }}>
          Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY on Vercel.
        </p>
      </div>
    )
  }

  function goSignIn() {
    const { path, params } = getHashRoute()
    if (path === 'account') {
      navigate('sign-in', {
        next: 'account',
        ...(params.tab ? { tab: params.tab } : {}),
      })
      return
    }
    navigate('sign-in')
  }

  if (!session) {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash || ''
      if (!hash.includes('sign-in') && !hash.includes('sign-up')) {
        queueMicrotask(goSignIn)
      }
    }
    return (
      <div className="fade-in" style={{ padding: 40, textAlign: 'center' }}>
        <p style={{ marginBottom: 16, color: 'var(--ink-secondary)' }}>Sign in to continue</p>
        <button
          type="button"
          className="pressable primary-cta"
          onClick={goSignIn}
          style={{
            padding: '14px 22px',
            borderRadius: 14,
            background: 'var(--orange)',
            color: '#fff',
            fontWeight: 700,
            boxShadow: 'var(--shadow-cta)',
          }}
        >
          Go to sign in
        </button>
      </div>
    )
  }

  return children
}
