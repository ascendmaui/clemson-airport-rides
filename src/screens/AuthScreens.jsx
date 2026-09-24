import { useEffect, useRef, useState } from 'react'
import {
  useAuth,
  getSignupRateLimitRemainingSec,
  markSignupRateLimited,
  isRateLimitError,
} from '../lib/auth'
import { getHashRoute, navigate } from '../lib/navigation'
import { resumeAfterAuth } from '../components/SignInToBookModal'
import { capturePromoFromLocation } from '../lib/riderPromo'
import { RIDE_STYLES, isProfileComplete, profileFieldError } from '../../packages/rides-native/partyProfile.js'

const fieldStyle = {
  width: '100%',
  marginTop: 6,
  padding: '14px 16px',
  borderRadius: 14,
  border: '1px solid rgba(255,255,255,0.35)',
  background: 'rgba(255,255,255,0.55)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
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
        background: 'linear-gradient(165deg, rgba(82,45,128,0.18) 0%, rgba(245,102,0,0.08) 42%, var(--surface-muted) 100%)',
      }}
    >
      <button
        type="button"
        className="pressable glass-pill"
        onClick={() => navigate(back)}
        style={{
          alignSelf: 'flex-start',
          marginBottom: 12,
          width: 44,
          height: 44,
          borderRadius: 14,
          fontSize: 18,
        }}
      >
        ←
      </button>
      <div
        className="modal-card glass-panel glass-panel--elevated"
        style={{
          width: '100%',
          maxWidth: 400,
          padding: 28,
          borderRadius: 24,
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

function afterAuthSuccess() {
  const { params } = getHashRoute()
  const stash = typeof window !== 'undefined' ? window.__clemsonAuthNext : null
  const merged = { ...(stash?.params || {}), ...params }
  if (!merged.next && stash?.path) merged.next = stash.path
  if (typeof window !== 'undefined') window.__clemsonAuthNext = null
  if (merged.next) {
    resumeAfterAuth(merged)
    return
  }
  navigate('home')
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
      afterAuthSuccess()
    } catch (err) {
      setError(err.message || 'Sign in failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to book airport rides. Surge applies on busy hours and game days.">
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
        <button type="button" className="pressable" onClick={() => {
          const { params } = getHashRoute()
          navigate('sign-up', params)
        }} style={{ color: 'var(--purple)', fontWeight: 700 }}>
          Create an account
        </button>
      </p>
    </AuthShell>
  )
}

export function SignUpScreen() {
  const { signUp } = useAuth()
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [bio, setBio] = useState('')
  const [rideStyle, setRideStyle] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [promo, setPromo] = useState(() => capturePromoFromLocation())
  const [error, setError] = useState(null)
  const [info, setInfo] = useState(null)
  const [created, setCreated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [cooldownSec, setCooldownSec] = useState(() => getSignupRateLimitRemainingSec())
  const submitLock = useRef(false)

  useEffect(() => {
    if (cooldownSec <= 0) return undefined
    const id = window.setInterval(() => {
      const left = getSignupRateLimitRemainingSec()
      setCooldownSec(left)
      if (left <= 0) window.clearInterval(id)
    }, 250)
    return () => window.clearInterval(id)
  }, [cooldownSec])

  async function onSubmit(e) {
    e.preventDefault()
    if (created || submitLock.current || busy) return
    const left = getSignupRateLimitRemainingSec()
    if (left > 0) {
      setCooldownSec(left)
      setError(`Too many signup emails just now. Try again in ${left}s, or sign in if you already created an account.`)
      return
    }
    setError(null)
    setInfo(null)
    const trimmed = email.trim()
    submitLock.current = true
    setBusy(true)
    try {
      const draft = { full_name: fullName, phone, bio, ride_style: rideStyle }
      const problem = profileFieldError(draft)
      if (problem) {
        setError(problem)
        return
      }
      const result = await signUp(trimmed, password, fullName.trim(), promo, { phone, bio, rideStyle })
      const claim = result?.promoClaim
      if (claim?.error) {
        setError(`Account created. ${claim.error}`)
        setCreated(true)
        return
      }
      if (promo.trim() && !result?.session) {
        setInfo('Account created. Confirm your email to sign in. Your promo code is stored with this signup and saved on your profile when you sign in. Rewards are issued only after your first completed ride.')
        setCreated(true)
        return
      }
      afterAuthSuccess()
    } catch (err) {
      if (isRateLimitError(err)) {
        const retry = err.retryAfterSec || left || 60
        markSignupRateLimited(retry)
        setCooldownSec(getSignupRateLimitRemainingSec() || retry)
        setError(
          `Too many signup emails just now. Try again in ${getSignupRateLimitRemainingSec() || retry}s, or sign in if you already created an account.`,
        )
      } else {
        setError(err.message || 'Sign up failed')
      }
    } finally {
      setBusy(false)
      submitLock.current = false
    }
  }

  const blocked = busy || cooldownSec > 0
  const profileReady = isProfileComplete({ full_name: fullName, phone, bio, ride_style: rideStyle })
  const cta =
    busy ? 'Creating…' : cooldownSec > 0 ? `Wait ${cooldownSec}s…` : 'Create account'

  return (
    <AuthShell title="Join Clemson RIDES" subtitle="Metered fares to GSP and CLT. Students save 10% on Standard.">
      <form onSubmit={onSubmit}>
        <p style={{ fontSize: 12, color: '#522D80', lineHeight: 1.4, marginBottom: 14 }}>
          A profile is required. The other person sees your name, bio, and ride style after a ride is accepted.
        </p>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Full name</span>
          <input required type="text" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} style={fieldStyle} disabled={blocked} />
        </label>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Mobile number</span>
          <input required type="tel" autoComplete="tel" placeholder="864-555-0100" value={phone} onChange={(e) => setPhone(e.target.value)} style={fieldStyle} disabled={blocked} />
        </label>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Short bio</span>
          <input required type="text" placeholder="How you like to ride" value={bio} onChange={(e) => setBio(e.target.value)} style={fieldStyle} disabled={blocked} />
        </label>
        <div style={{ marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Ride style</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {RIDE_STYLES.map((style) => {
              const on = rideStyle === style
              return (
                <button
                  key={style}
                  type="button"
                  onClick={() => setRideStyle(style)}
                  disabled={blocked}
                  style={{
                    borderRadius: 999,
                    padding: '8px 12px',
                    fontWeight: 700,
                    border: on ? '1px solid #522D80' : '1px solid rgba(82,45,128,0.2)',
                    background: on ? '#522D80' : '#fff',
                    color: on ? '#fff' : '#522D80',
                  }}
                >
                  {style}
                </button>
              )
            })}
          </div>
        </div>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Email <span style={{ fontWeight: 500, color: 'var(--ink-tertiary)' }}>(Clemson email gets student pricing)</span></span>
          <input required type="email" autoComplete="email" placeholder="you@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} style={fieldStyle} disabled={blocked} />
        </label>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Password</span>
          <input required type="password" autoComplete="new-password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} style={fieldStyle} disabled={blocked || created} />
        </label>
        <label style={{ display: 'block', marginBottom: 18 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Promo code <span style={{ fontWeight: 500, color: 'var(--ink-tertiary)' }}>(optional)</span></span>
          <input
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            placeholder="Friend's code"
            value={promo}
            onChange={(e) => setPromo(e.target.value.toUpperCase())}
            style={fieldStyle}
            disabled={blocked || created}
          />
          <span style={{ display: 'block', marginTop: 6, fontSize: 12, color: '#522D80', lineHeight: 1.4 }}>
            Applied when you create the account. You and your friend are rewarded only after you complete your first ride.
          </span>
        </label>
        {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>{error}</p>}
        {info && <p style={{ color: '#522D80', fontSize: 13, marginBottom: 12, lineHeight: 1.45 }}>{info}</p>}
        {cooldownSec > 0 && !error && (
          <p style={{ color: 'var(--ink-secondary)', fontSize: 13, marginBottom: 12 }}>
            Email send limit cooling down — retry in {cooldownSec}s.
          </p>
        )}
        {created ? (
          <button type="button" className="pressable primary-cta" onClick={afterAuthSuccess} style={{ width: '100%', padding: 16, borderRadius: 16, background: 'linear-gradient(135deg, #F56600 0%, #ff7a1a 100%)', color: '#fff', fontWeight: 700, fontSize: 16, boxShadow: 'var(--shadow-cta)' }}>
            Continue
          </button>
        ) : (
          <button type="submit" className="pressable primary-cta" disabled={blocked || !profileReady} style={{ width: '100%', padding: 16, borderRadius: 16, background: 'linear-gradient(135deg, var(--orange) 0%, #ff7a1a 100%)', color: '#fff', fontWeight: 700, fontSize: 16, boxShadow: 'var(--shadow-cta)', opacity: blocked || !profileReady ? 0.7 : 1 }}>
            {cta}
          </button>
        )}
      </form>
      <p style={{ marginTop: 18, fontSize: 14, color: 'var(--ink-secondary)', textAlign: 'center' }}>
        Already have an account?{' '}
        <button type="button" className="pressable" onClick={() => {
          const { params } = getHashRoute()
          navigate('sign-in', params)
        }} style={{ color: 'var(--purple)', fontWeight: 700 }}>
          Sign in
        </button>
      </p>
    </AuthShell>
  )
}
