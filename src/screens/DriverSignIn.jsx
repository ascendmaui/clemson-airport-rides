/**
 * Web driver sign-in (#/driver-sign-in, /driver/sign-in, /driver/login).
 * Bridge until the native Driver app is approved: approved drivers sign in
 * here with the same Supabase account they use in the Driver app, then land
 * on the live console at /driver. The rider sign-in stays Google-only.
 * Approval is not decided here; /driver shows the approval status page to
 * anyone whose application is not approved, and the server rejects accepts.
 */
import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { getHashRoute, navigate } from '../lib/navigation'
import { AccessibleAlert } from '../components/AccessibleAlert'
import { appleWebSignInEnabled } from '../lib/webDriverConsole'

const ORANGE = '#F56600'
const PURPLE = '#522D80'
const APPLE_ON = appleWebSignInEnabled(import.meta.env || {})

function nextParams() {
  const { params } = getHashRoute()
  return { ...params, next: params.next || 'driver' }
}

function goNext() {
  const { next, ...rest } = nextParams()
  navigate(next || 'driver', rest)
}

function AppleMark() {
  return (
    <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M13.2 9.6c0-2.1 1.7-3.1 1.8-3.2-1-1.4-2.5-1.6-3-1.7-1.3-.1-2.5.8-3.1.8-.7 0-1.6-.8-2.7-.7-1.4 0-2.7.8-3.4 2.1-1.5 2.5-.4 6.3 1 8.4.7 1 1.5 2.1 2.6 2.1 1 0 1.4-.7 2.7-.7 1.2 0 1.6.7 2.7.7 1.1 0 1.8-1 2.5-2 .8-1.2 1.1-2.3 1.1-2.4 0 0-2.2-.8-2.2-3.4zM11.2 3.4c.6-.7 1-1.7.9-2.7-.9 0-1.9.6-2.5 1.3-.6.6-1 1.6-.9 2.6 1 .1 1.9-.5 2.5-1.2z" />
    </svg>
  )
}

const field = {
  width: '100%',
  padding: '14px 16px',
  borderRadius: 14,
  border: '1px solid rgba(82,45,128,0.22)',
  fontSize: 16,
  background: '#fff',
  color: '#1d1b20',
}

export function DriverSignIn() {
  const { session, loading, signIn, signInWithGoogle, signInWithApple } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!loading && session) goNext()
  }, [loading, session])

  async function onEmail(event) {
    event.preventDefault()
    if (busy) return
    if (!email.trim() || !password) {
      setError('Enter the email and password you use in the Clemson Rides Driver app.')
      return
    }
    setBusy('email')
    setError(null)
    try {
      await signIn(email.trim(), password)
      goNext()
    } catch (err) {
      setError(err.message || 'Sign-in failed')
    } finally {
      setBusy(null)
    }
  }

  async function onOAuth(kind) {
    if (busy) return
    setBusy(kind)
    setError(null)
    try {
      if (kind === 'apple') await signInWithApple({ nextParams: nextParams() })
      else await signInWithGoogle({ nextParams: nextParams() })
    } catch (err) {
      setError(err.message || 'Sign-in failed')
      setBusy(null)
    }
  }

  return (
    <div className="fade-in driver-sign-in" data-route="driver-sign-in" style={{ minHeight: '100%', background: `linear-gradient(180deg, ${PURPLE} 0%, #3b1f5e 38%, #f7f3fb 38%)`, padding: '28px 20px 40px' }}>
      <button type="button" className="pressable" aria-label="Back" onClick={() => navigate('landing')} style={{ color: '#fff', fontSize: 20 }}>←</button>
      <div style={{ color: '#fff', marginTop: 18, marginBottom: 22 }}>
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.4, color: ORANGE, textTransform: 'uppercase' }}>Clemson Rides · Driver</div>
        <h1 style={{ fontSize: 28, fontWeight: 800, marginTop: 6, letterSpacing: -0.4 }}>Drive on the web</h1>
        <p style={{ fontSize: 15, opacity: 0.88, marginTop: 6, lineHeight: 1.45 }}>
          Approved drivers can go online, take requests, and run trips here until the Driver app is in the App Store.
        </p>
      </div>
      <div className="sheet" style={{ background: '#fff', borderRadius: 24, padding: 22, boxShadow: '0 12px 32px rgba(82,45,128,0.18)' }}>
        <form onSubmit={onEmail} noValidate aria-label="Driver sign in">
          <label htmlFor="driver-signin-email" style={{ display: 'block', fontSize: 13, fontWeight: 700, color: PURPLE, marginBottom: 6 }}>Email</label>
          <input id="driver-signin-email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} style={field} />
          <label htmlFor="driver-signin-password" style={{ display: 'block', fontSize: 13, fontWeight: 700, color: PURPLE, margin: '14px 0 6px' }}>Password</label>
          <input id="driver-signin-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} style={field} />
          <button type="submit" className="pressable primary-cta" disabled={Boolean(busy)} aria-busy={busy === 'email' ? 'true' : undefined} style={{ width: '100%', marginTop: 18, padding: 16, borderRadius: 16, background: ORANGE, color: '#fff', fontWeight: 800, fontSize: 16, opacity: busy ? 0.7 : 1 }}>
            {busy === 'email' ? 'Signing in…' : 'Sign in to drive'}
          </button>
        </form>
        <div aria-hidden="true" style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0 12px', color: '#8a8494', fontSize: 12, fontWeight: 700 }}>
          <span style={{ flex: 1, height: 1, background: 'rgba(82,45,128,0.18)' }} />or<span style={{ flex: 1, height: 1, background: 'rgba(82,45,128,0.18)' }} />
        </div>
        {APPLE_ON && (
          <button type="button" className="pressable" data-testid="driver-apple-sign-in" onClick={() => onOAuth('apple')} disabled={Boolean(busy)} style={{ width: '100%', padding: 14, borderRadius: 16, background: '#000', color: '#fff', fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 10, opacity: busy ? 0.7 : 1 }}>
            <AppleMark />{busy === 'apple' ? 'Opening Apple…' : 'Sign in with Apple'}
          </button>
        )}
        <button type="button" className="pressable glass-pill" onClick={() => onOAuth('google')} disabled={Boolean(busy)} style={{ width: '100%', padding: 14, borderRadius: 16, color: PURPLE, fontWeight: 700, fontSize: 15, border: '1px solid rgba(82,45,128,0.22)', opacity: busy ? 0.7 : 1 }}>
          {busy === 'google' ? 'Opening Google…' : 'Continue with Google'}
        </button>
        {error && (
          <div id="driver-signin-alert" style={{ marginTop: 14 }}>
            <AccessibleAlert error={error} onDismiss={() => setError(null)} />
          </div>
        )}
        <p style={{ marginTop: 18, fontSize: 14, color: '#5f5a66', textAlign: 'center', lineHeight: 1.5 }}>
          Not a driver yet?{' '}
          <button type="button" className="pressable" onClick={() => navigate('drive')} style={{ color: PURPLE, fontWeight: 700, minHeight: 44 }}>Apply to drive</button>
          <br />
          Need a ride?{' '}
          <button type="button" className="pressable" onClick={() => navigate('sign-in')} style={{ color: PURPLE, fontWeight: 700, minHeight: 44 }}>Rider sign in</button>
        </p>
      </div>
    </div>
  )
}
