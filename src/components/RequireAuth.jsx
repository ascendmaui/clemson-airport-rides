import { SignedIn, SignedOut, useAuth } from '@clerk/clerk-react'
import { navigate } from '../lib/navigation'
import { isClerkConfigured } from '../lib/clerkConfig'

export function RequireAuth({ children }) {
  if (!isClerkConfigured) {
    return (
      <>
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            right: 8,
            zIndex: 50,
            padding: '8px 12px',
            borderRadius: 10,
            background: 'rgba(82,45,128,0.92)',
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
            textAlign: 'center',
            pointerEvents: 'none',
          }}
        >
          Clerk key not set — preview mode (sign-in unlocked once VITE_CLERK_PUBLISHABLE_KEY is live)
        </div>
        {children}
      </>
    )
  }

  return <RequireAuthClerk>{children}</RequireAuthClerk>
}

function RequireAuthClerk({ children }) {
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
