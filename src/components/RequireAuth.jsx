import { SignedIn, SignedOut, useAuth } from '@clerk/clerk-react'
import { navigate } from '../lib/navigation'

export function RequireAuth({ children }) {
  const { isLoaded } = useAuth()

  if (!isLoaded) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-secondary)' }}>
        Loading…
      </div>
    )
  }

  return (
    <>
      <SignedIn>{children}</SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  )
}

function RedirectToSignIn() {
  if (typeof window !== 'undefined') {
    const hash = window.location.hash || ''
    if (!hash.includes('sign-in') && !hash.includes('sign-up')) {
      // Defer navigate to avoid render-phase side effects stacking
      queueMicrotask(() => navigate('sign-in'))
    }
  }
  return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <p style={{ marginBottom: 16, color: 'var(--ink-secondary)' }}>Sign in to continue</p>
      <button
        type="button"
        className="pressable"
        onClick={() => navigate('sign-in')}
        style={{
          padding: '12px 20px',
          borderRadius: 12,
          background: 'var(--orange)',
          color: '#fff',
          fontWeight: 700,
          boxShadow: 'var(--shadow-pill)',
        }}
      >
        Go to sign in
      </button>
    </div>
  )
}
