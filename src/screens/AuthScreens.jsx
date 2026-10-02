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
import { RIDE_STYLES, isProfileComplete, profileFieldError, missingProfileFields } from '../../packages/rides-native/partyProfile.js'
import { buildFieldA11yProps, getFieldErrorProps } from '../lib/formA11y.js'
import { takeAuthCallbackError } from '../lib/googleWebAuth'
import { AccessibleAlert } from '../components/AccessibleAlert'

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

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" />
      <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z" />
    </svg>
  )
}

function GoogleContinue({ busy, disabled, onClick }) {
  const label = busy ? 'Opening Google…' : 'Continue with Google'
  return (
    <div style={{ marginBottom: 8 }}>
      <button
        type="button"
        className="pressable glass-pill"
        onClick={onClick}
        disabled={disabled || busy}
        aria-busy={busy ? 'true' : undefined}
        aria-label={label}
        style={{
          width: '100%',
          padding: '14px 16px',
          borderRadius: 16,
          color: 'var(--purple)',
          fontWeight: 700,
          fontSize: 15,
          opacity: disabled || busy ? 0.7 : 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
        }}
      >
        <GoogleMark />
        {label}
      </button>
      <div
        aria-hidden="true"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          margin: '16px 0 8px',
          color: 'var(--ink-tertiary)',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 0.3,
        }}
      >
        <span style={{ flex: 1, height: 1, background: 'rgba(82,45,128,0.18)' }} />
        or use email
        <span style={{ flex: 1, height: 1, background: 'rgba(82,45,128,0.18)' }} />
      </div>
    </div>
  )
}

function useStoredAuthError(setError) {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const storage = window.sessionStorage
    const stored = takeAuthCallbackError(storage)
    if (stored) setError(stored)
    const onError = (event) => {
      takeAuthCallbackError(storage)
      const message = event?.detail || ''
      if (message) setError(message)
    }
    window.addEventListener('clemson-auth-error', onError)
    return () => window.removeEventListener('clemson-auth-error', onError)
  }, [setError])
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
  const { signIn, signInWithGoogle } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [formInvalid, setFormInvalid] = useState(false)
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  useStoredAuthError(setError)

  async function onSubmit(e) {
    e.preventDefault()
    setError(null)
    setFormInvalid(false)
    setBusy(true)
    try {
      await signIn(email.trim(), password)
      afterAuthSuccess()
    } catch (err) {
      setFormInvalid(true)
      setError(err.message || 'Sign in failed')
    } finally {
      setBusy(false)
    }
  }

  async function onGoogle() {
    if (busy || googleBusy) return
    setError(null)
    setFormInvalid(false)
    setGoogleBusy(true)
    try {
      const { params } = getHashRoute()
      await signInWithGoogle({ nextParams: params })
    } catch (err) {
      setError(err.message || 'Google sign-in failed')
      setGoogleBusy(false)
    }
  }

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to book airport rides. Surge applies on busy hours and game days.">
      <GoogleContinue busy={googleBusy} disabled={busy} onClick={onGoogle} />
      {error && (
        <div id="signin-form-alert">
          <AccessibleAlert error={error} onDismiss={() => setError(null)} style={{ marginBottom: 12 }} />
        </div>
      )}
      <form onSubmit={onSubmit}>
        <label htmlFor="signin-email" style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Email</span>
          <input
            id="signin-email"
            required
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={formInvalid ? 'true' : undefined}
            aria-describedby={formInvalid ? 'signin-form-alert' : undefined}
            style={fieldStyle}
          />
        </label>
        <label htmlFor="signin-password" style={{ display: 'block', marginBottom: 18 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Password</span>
          <input
            id="signin-password"
            required
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={formInvalid ? 'true' : undefined}
            aria-describedby={formInvalid ? 'signin-form-alert' : undefined}
            style={fieldStyle}
          />
        </label>
        <button type="submit" className="pressable primary-cta" disabled={busy || googleBusy} style={{ width: '100%', padding: 16, borderRadius: 16, background: 'linear-gradient(135deg, var(--orange) 0%, #ff7a1a 100%)', color: '#fff', fontWeight: 700, fontSize: 16, boxShadow: 'var(--shadow-cta)', opacity: busy || googleBusy ? 0.7 : 1 }}>
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
      <PolicyLinks />
    </AuthShell>
  )
}

function PolicyLinks() {
  const link = { color: 'var(--purple)', fontWeight: 700 }
  return (
    <p style={{ marginTop: 10, fontSize: 13, color: 'var(--ink-tertiary)', textAlign: 'center' }}>
      <button type="button" className="pressable" onClick={() => navigate('privacy')} style={link}>Privacy</button>
      {' · '}
      <button type="button" className="pressable" onClick={() => navigate('terms')} style={link}>Terms</button>
    </p>
  )
}

export function SignUpScreen() {
  const { signUp, signInWithGoogle } = useAuth()
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
  const [touchedSubmit, setTouchedSubmit] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const submitLock = useRef(false)
  useStoredAuthError(setError)

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
    setTouchedSubmit(true)
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

  const blocked = busy || googleBusy || cooldownSec > 0

  async function onGoogle() {
    if (busy || googleBusy) return
    setError(null)
    setInfo(null)
    setGoogleBusy(true)
    try {
      const { params } = getHashRoute()
      await signInWithGoogle({ nextParams: params, promoCode: promo })
    } catch (err) {
      setError(err.message || 'Google sign-in failed')
      setGoogleBusy(false)
    }
  }
  const profileReady = isProfileComplete({ full_name: fullName, phone, bio, ride_style: rideStyle })
  const missingFields = missingProfileFields({ full_name: fullName, phone, bio, ride_style: rideStyle })
  const showValidation = touchedSubmit
  const cta =
    busy ? 'Creating…' : cooldownSec > 0 ? `Wait ${cooldownSec}s…` : 'Create account'

  return (
    <AuthShell title="Join Clemson RIDES" subtitle="Metered fares to GSP and CLT. Students save 10% on Standard.">
      <GoogleContinue busy={googleBusy} disabled={busy} onClick={onGoogle} />
      {error && (
        <div id="signup-form-alert">
          <AccessibleAlert error={error} onDismiss={() => setError(null)} style={{ marginBottom: 12 }} />
        </div>
      )}
      <form onSubmit={onSubmit}>
        <p style={{ fontSize: 12, color: '#522D80', lineHeight: 1.4, marginBottom: 14 }}>
          A profile is required. The other person sees your name, bio, and ride style after a ride is accepted.
        </p>
        <label htmlFor="signup-fullname" style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Full name</span>
          <input
            id="signup-fullname"
            required
            type="text"
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            aria-invalid={showValidation && missingFields.includes('full_name') ? 'true' : undefined}
            aria-describedby={showValidation && missingFields.includes('full_name') ? 'signup-fullname-error' : undefined}
            style={fieldStyle}
            disabled={blocked}
          />
          {showValidation && missingFields.includes('full_name') && (
            <span id="signup-fullname-error" role="alert" className="field-error-text">
              Full name is required (minimum 2 characters).
            </span>
          )}
        </label>
        <label htmlFor="signup-phone" style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Mobile number</span>
          <input
            id="signup-phone"
            required
            type="tel"
            autoComplete="tel"
            placeholder="864-555-0100"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-invalid={showValidation && missingFields.includes('phone') ? 'true' : undefined}
            aria-describedby={showValidation && missingFields.includes('phone') ? 'signup-phone-error' : undefined}
            style={fieldStyle}
            disabled={blocked}
          />
          {showValidation && missingFields.includes('phone') && (
            <span id="signup-phone-error" role="alert" className="field-error-text">
              Valid 10-digit mobile number is required.
            </span>
          )}
        </label>
        <label htmlFor="signup-bio" style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Short bio</span>
          <input
            id="signup-bio"
            required
            type="text"
            placeholder="How you like to ride"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            aria-invalid={showValidation && missingFields.includes('bio') ? 'true' : undefined}
            aria-describedby={showValidation && missingFields.includes('bio') ? 'signup-bio-error' : undefined}
            style={fieldStyle}
            disabled={blocked}
          />
          {showValidation && missingFields.includes('bio') && (
            <span id="signup-bio-error" role="alert" className="field-error-text">
              Bio must be at least 8 characters.
            </span>
          )}
        </label>
        <div role="group" aria-labelledby="signup-ridestyle-label" style={{ marginBottom: 14 }}>
          <span id="signup-ridestyle-label" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Ride style</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {RIDE_STYLES.map((style) => {
              const on = rideStyle === style
              return (
                <button
                  key={style}
                  type="button"
                  aria-pressed={on}
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
          {showValidation && missingFields.includes('ride_style') && (
            <span id="signup-ridestyle-error" role="alert" className="field-error-text">
              Please choose a ride style.
            </span>
          )}
        </div>
        <label htmlFor="signup-email" style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>
            Email <span id="signup-email-hint" style={{ fontWeight: 500, color: 'var(--ink-tertiary)' }}>(Clemson email gets student pricing)</span>
          </span>
          <input
            id="signup-email"
            required
            type="email"
            autoComplete="email"
            placeholder="you@gmail.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-describedby="signup-email-hint"
            style={fieldStyle}
            disabled={blocked}
          />
        </label>
        <label htmlFor="signup-password" style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Password</span>
          <input
            id="signup-password"
            required
            type="password"
            autoComplete="new-password"
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={fieldStyle}
            disabled={blocked || created}
          />
        </label>
        <label htmlFor="signup-promo" style={{ display: 'block', marginBottom: 18 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>
            Promo code <span style={{ fontWeight: 500, color: 'var(--ink-tertiary)' }}>(optional)</span>
          </span>
          <input
            id="signup-promo"
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            placeholder="Friend's code"
            value={promo}
            onChange={(e) => setPromo(e.target.value.toUpperCase())}
            aria-describedby="signup-promo-hint"
            style={fieldStyle}
            disabled={blocked || created}
          />
          <span id="signup-promo-hint" style={{ display: 'block', marginTop: 6, fontSize: 12, color: '#522D80', lineHeight: 1.4 }}>
            Applied when you create the account. You and your friend are rewarded only after you complete your first ride.
          </span>
        </label>
        {info && (
          <p role="status" aria-live="polite" style={{ color: '#522D80', fontSize: 13, marginBottom: 12, lineHeight: 1.45 }}>
            {info}
          </p>
        )}
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
      <PolicyLinks />
    </AuthShell>
  )
}
