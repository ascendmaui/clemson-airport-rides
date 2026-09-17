import { SignIn, SignUp } from '@clerk/clerk-react'
import { navigate } from '../lib/navigation'

const appearance = {
  variables: {
    colorPrimary: '#F56600',
    colorText: '#1a1a1a',
    borderRadius: '12px',
  },
  elements: {
    card: {
      boxShadow: '0 8px 30px rgba(82, 45, 128, 0.12)',
      border: '1px solid rgba(82, 45, 128, 0.08)',
    },
  },
}

export function SignInScreen() {
  return (
    <div
      className="fade-in"
      style={{
        minHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'var(--surface-muted)',
      }}
    >
      <button
        type="button"
        className="pressable"
        onClick={() => navigate('landing')}
        style={{ alignSelf: 'flex-start', marginBottom: 12, fontSize: 20 }}
      >
        ←
      </button>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: 'var(--purple)' }}>
        Clemson RIDES
      </h1>
      <p style={{ color: 'var(--ink-secondary)', marginBottom: 20, fontSize: 14 }}>
        Sign in to book airport rides
      </p>
      <SignIn
        routing="hash"
        signUpUrl="#/sign-up"
        forceRedirectUrl="#/home"
        appearance={appearance}
      />
    </div>
  )
}

export function SignUpScreen() {
  return (
    <div
      className="fade-in"
      style={{
        minHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'var(--surface-muted)',
      }}
    >
      <button
        type="button"
        className="pressable"
        onClick={() => navigate('landing')}
        style={{ alignSelf: 'flex-start', marginBottom: 12, fontSize: 20 }}
      >
        ←
      </button>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: 'var(--purple)' }}>
        Join Clemson RIDES
      </h1>
      <SignUp
        routing="hash"
        signInUrl="#/sign-in"
        forceRedirectUrl="#/home"
        appearance={appearance}
      />
    </div>
  )
}
