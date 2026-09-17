import { useState } from 'react'
import { useAuth } from '../lib/auth'
import { navigate } from '../lib/navigation'

const fieldStyle = {
  width: '100%',
  marginTop: 6,
  padding: '14px 16px',
  borderRadius: 14,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  boxShadow: 'inset 0 1px 2px rgba(11,18,32,0.03)',
  outline: 'none',
  transition: 'border-color 200ms var(--ease-soft), box-shadow 200ms var(--ease-soft)',
}

function AuthShell({ title, subtitle, children, back = 'landing' }) {
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
        background: 'linear-gradient(180deg, var(--purple-soft) 0%, var(--surface-muted) 42%, var(--surface-muted) 100%)',
      }}
    >
      <button
        type="button"
        className="pressable"
        onClick={() => navigate(back)}
        style={{
          alignSelf: 'flex-start',
          marginBottom: 12,
          width: 44,
          height: 44,
          borderRadius: 14,
          background: 'var(--surface)',
          boxShadow: 'var(--shadow-pill)',
          fontSize: 18,
        }}
      >
        ←
      </button>
      <div
        className="modal-card"
        style={{
          width: '100%',
          maxWidth: 400,
          padding: 28,
          background: 'var(--surface)',
          borderRadius: 24,
          boxShadow: 'var(--shadow-modal)',
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            background: 'linear-gradient(135deg, var(--orange) 0%, #ff8a3d 100%)',
            boxShadow: 'var(--shadow-cta)',
            display: 'grid',
            placeItems: 'center',
            color: '#fff',
            fontWeight: 800,
            marginBottom: 16,
          }}
        >
          CR
        </div>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6, color: 'var(--purple)', letterSpacing: -0.3 }}>
          {title}
        </h1>
        <p style={{ color: 'var(--ink-secondary)', marginBottom: 22, fontSize: 14, lineHeight: 1.45 }}>{subtitle}</p>
        {children}
      </div>
    </div>
  )
}

export function SignInScreen() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signIn(email.trim(), password)
      navigate('home')
    } catch (err) {
      setError(err.message || 'Sign in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to book airport rides without surge.">
      <form onSubmit={onSubmit}>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Email</span>
          <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} style={fieldStyle} />
        </label>
        <label style={{ display: 'block', marginBottom: 18 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Password</span>
          <input required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} style={fieldStyle} />
        </label>
        {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{error}</p>}
        <button type="submit" className="pressable primary-cta" disabled={busy} style={{ width: '100%', padding: 16, borderRadius: 16, background: 'linear-gradient(135deg, var(--orange) 0%, #ff7a1a 100%)', color: '#fff', fontWeight: 700, fontSize: 16, boxShadow: 'var(--shadow-cta)', opacity: busy ? 0.7 : 1 }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p style={{ marginTop: 18, fontSize: 14, color: 'var(--ink-secondary)', textAlign: 'center' }}>
        New here?{' '}
        <button type="button" className="pressable" onClick={() => navigate('sign-up')} style={{ color: 'var(--purple)', fontWeight: 700 }}>
          Create an account
        </button>
      </p>
    </AuthShell>
  )
}

export function SignUpScreen() {
  const { signUp } = useAuth()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signUp(email.trim(), password, fullName.trim())
      navigate('home')
    } catch (err) {
      setError(err.message || 'Sign up failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Join Clemson RIDES" subtitle="Flat rates to GSP & CLT. Skip the surge.">
      <form onSubmit={onSubmit}>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Full name</span>
          <input required type="text" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} style={fieldStyle} />
        </label>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Email</span>
          <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} style={fieldStyle} />
        </label>
        <label style={{ display: 'block', marginBottom: 18 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Password</span>
          <input required type="password" autoComplete="new-password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} style={fieldStyle} />
        </label>
        {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{error}</p>}
        <button type="submit" className="pressable primary-cta" disabled={busy} style={{ width: '100%', padding: 16, borderRadius: 16, background: 'linear-gradient(135deg, var(--orange) 0%, #ff7a1a 100%)', color: '#fff', fontWeight: 700, fontSize: 16, boxShadow: 'var(--shadow-cta)', opacity: busy ? 0.7 : 1 }}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
      <p style={{ marginTop: 18, fontSize: 14, color: 'var(--ink-secondary)', textAlign: 'center' }}>
        Already have an account?{' '}
        <button type="button" className="pressable" onClick={() => navigate('sign-in')} style={{ color: 'var(--purple)', fontWeight: 700 }}>
          Sign in
        </button>
      </p>
    </AuthShell>
  )
}
