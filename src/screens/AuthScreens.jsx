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
import { CLEMSON_MIAMI_RIDE } from '../../packages/rides-native/clemsonMiamiPromo.js'
import {
  hasClemsonMiamiLink,
  openClemsonMiamiCheckout,
  rememberClemsonMiamiFromLocation,
  takeClemsonMiamiNotice,
} from '../lib/clemsonMiamiRide'
import { RIDE_STYLES } from '../../packages/rides-native/partyProfile.js'
import { formatAccessibleFormErrorSummary } from '../lib/formA11y.js'
import { signupFieldErrors } from '../lib/signupFields.js'
import { takeAuthCallbackError } from '../lib/googleWebAuth'
import { supabase } from '../lib/supabase'
import { AccessibleAlert } from '../components/AccessibleAlert'
import { textLinkHitStyle } from '../lib/touchA11y'

const fieldStyle = {
  width: '100%',
  marginTop: 6,
  padding: '16px 14px',
  borderRadius: 10,
  border: 'none',
  background: '#ececec',
  outline: 'none',
}

function AuthShell({ title, subtitle, children, back = 'landing', step }) {
  return (
    <div className="lux-auth fade-in">
      <button type="button" className="lux-auth-back pressable" onClick={() => navigate(back)}>
        Back
      </button>
      {step ? <p className="lux-step">{step}</p> : null}
      <h1>{title}</h1>
      <p className="lux-auth-sub">{subtitle}</p>
      <div className="lux-auth-body">{children}</div>
      <p className="lux-legal-mini">
        By continuing you agree to the{' '}
        <button type="button" className="pressable" onClick={() => navigate('terms')}>terms</button>
        {' '}and{' '}
        <button type="button" className="pressable" onClick={() => navigate('privacy')}>privacy policy</button>.
      </p>
    </div>
  )
}

function EmailCode({ email }) {
  const [digits, setDigits] = useState(['', '', '', '', '', ''])
  const [note, setNote] = useState(null)
  const [busy, setBusy] = useState(false)
  const refs = useRef([])

  function setAt(index, value) {
    const char = value.replace(/\D/g, '').slice(-1)
    const next = digits.slice()
    next[index] = char
    setDigits(next)
    if (char && index < 5) refs.current[index + 1]?.focus()
    if (next.every(Boolean)) submit(next.join(''))
  }

  async function submit(code) {
    if (!supabase || busy) return
    setBusy(true)
    setNote(null)
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' })
    setBusy(false)
    if (error) setNote(error.message || 'That code was not accepted. Use the link in the email.')
    else navigate('home')
  }

  return (
    <div className="lux-otp-block">
      <p style={{ fontSize: 13, color: '#6d6d6d', marginBottom: 8 }}>Email code, if one was sent.</p>
      <div className="lux-otp">
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(node) => { refs.current[index] = node }}
            className="lux-field"
            inputMode="numeric"
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            aria-label={`Digit ${index + 1} of 6`}
            value={digit}
            onChange={(e) => setAt(index, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && !digits[index] && index > 0) refs.current[index - 1]?.focus()
            }}
          />
        ))}
      </div>
      {note ? <p role="status" style={{ color: '#8a3b32', fontSize: 13, marginBottom: 8 }}>{note}</p> : null}
      {busy ? <p style={{ fontSize: 13, color: '#6d6d6d' }}>Checking the code…</p> : null}
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

function GoogleContinue({ busy, disabled, onClick, showEmailDivider = true, variant = 'glass' }) {
  const label = busy ? 'Opening Google…' : 'Continue with Google'
  const primary = variant === 'primary'
  return (
    <div style={{ marginBottom: showEmailDivider ? 8 : 0 }}>
      <button
        type="button"
        className={primary ? 'pressable primary-cta' : 'pressable glass-pill'}
        onClick={onClick}
        disabled={disabled || busy}
        aria-busy={busy ? 'true' : undefined}
        aria-label={label}
        style={{
          width: '100%',
          padding: primary ? 16 : '14px 16px',
          borderRadius: 16,
          background: primary ? 'linear-gradient(135deg, var(--orange) 0%, #ff7a1a 100%)' : undefined,
          color: primary ? '#fff' : 'var(--purple)',
          fontWeight: 700,
          fontSize: primary ? 16 : 15,
          boxShadow: primary ? 'var(--shadow-cta)' : undefined,
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
      {showEmailDivider ? (
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
      ) : null}
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

function useClemsonMiamiNotice(setMessage) {
  useEffect(() => {
    const stored = takeClemsonMiamiNotice()
    if (stored) setMessage(stored)
    const onNotice = () => {
      const message = takeClemsonMiamiNotice()
      if (message) setMessage(message)
    }
    window.addEventListener('clemson-miami-notice', onNotice)
    return () => window.removeEventListener('clemson-miami-notice', onNotice)
  }, [setMessage])
}

function GameRideNote() {
  const gameLink = getHashRoute().params.ride === CLEMSON_MIAMI_RIDE
  if (!gameLink) return null
  return (
    <p style={{ fontSize: 13, color: '#522D80', lineHeight: 1.45, marginBottom: 14 }}>
      This link is a $1 ride inside Clemson to the Clemson Miami game. It applies when you sign up or sign in. There is no code to enter.
    </p>
  )
}

async function afterAuthSuccess() {
  rememberClemsonMiamiFromLocation()
  if (hasClemsonMiamiLink()) {
    const started = await openClemsonMiamiCheckout()
    if (started) return
  }
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
  const { signInWithGoogle } = useAuth()
  const [error, setError] = useState(null)
  const [googleBusy, setGoogleBusy] = useState(false)
  useStoredAuthError(setError)
  useClemsonMiamiNotice(setError)

  async function onGoogle() {
    if (googleBusy) return
    setError(null)
    setGoogleBusy(true)
    try {
      rememberClemsonMiamiFromLocation()
      const { params } = getHashRoute()
      await signInWithGoogle({ nextParams: params })
    } catch (err) {
      setError(err.message || 'Google sign-in failed')
      setGoogleBusy(false)
    }
  }

  return (
    <AuthShell title="Welcome back" subtitle="Sign in with Google to book airport rides. Surge applies on busy hours and game days." step="Step 1 of 2">
      <GoogleContinue busy={googleBusy} onClick={onGoogle} showEmailDivider={false} variant="primary" />
      <GameRideNote />
      {error && (
        <div id="signin-form-alert">
          <AccessibleAlert error={error} onDismiss={() => setError(null)} style={{ marginBottom: 12 }} />
        </div>
      )}
      <p style={{ marginTop: 18, fontSize: 14, color: 'var(--ink-secondary)', textAlign: 'center' }}>
        New here?{' '}
        <button type="button" className="pressable" onClick={() => {
          const { params } = getHashRoute()
          navigate('sign-up', params)
        }} style={textLinkHitStyle({ color: 'var(--purple)', fontWeight: 700 })}>
          Create an account
        </button>
      </p>
      <PolicyLinks />
    </AuthShell>
  )
}

function PolicyLinks() {
  const link = textLinkHitStyle({ color: 'var(--purple)', fontWeight: 700 })
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
  useClemsonMiamiNotice(setInfo)
  const [created, setCreated] = useState(false)
  const [busy, setBusy] = useState(false)
  const [cooldownSec, setCooldownSec] = useState(() => getSignupRateLimitRemainingSec())
  const [touchedSubmit, setTouchedSubmit] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const submitLock = useRef(false)
  const gameLink = getHashRoute().params.ride === CLEMSON_MIAMI_RIDE
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
    const trimmed = email.trim()
    const fieldErrors = signupFieldErrors({ fullName, phone, bio, rideStyle, email: trimmed, password })
    if (Object.keys(fieldErrors).length) {
      setError(formatAccessibleFormErrorSummary(fieldErrors))
      setInfo(null)
      return
    }
    setError(null)
    setInfo(null)
    submitLock.current = true
    setBusy(true)
    try {
      const result = await signUp(trimmed, password, fullName.trim(), gameLink ? '' : promo, { phone, bio, rideStyle })
      const claim = result?.promoClaim
      if (claim?.error) {
        setError(`Account created. ${claim.error}`)
        setCreated(true)
        return
      }
      if (!result?.session && hasClemsonMiamiLink()) {
        setInfo('Account created. Confirm your email and sign in. The $1 Clemson Miami ride starts automatically on this browser. There is no code to enter.')
        setCreated(true)
        return
      }
      if (promo.trim() && !result?.session) {
        setInfo('Account created. Confirm your email to sign in. Your promo code is stored with this signup and saved on your profile when you sign in. Rewards are issued only after your first completed ride.')
        setCreated(true)
        return
      }
      await afterAuthSuccess()
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
      rememberClemsonMiamiFromLocation()
      const { params } = getHashRoute()
      await signInWithGoogle({ nextParams: params, promoCode: promo })
    } catch (err) {
      setError(err.message || 'Google sign-in failed')
      setGoogleBusy(false)
    }
  }
  const showValidation = touchedSubmit
  const fieldErrors = showValidation
    ? signupFieldErrors({ fullName, phone, bio, rideStyle, email, password })
    : {}
  const cta =
    busy ? 'Creating…' : cooldownSec > 0 ? `Wait ${cooldownSec}s…` : 'Create account'

  return (
    <AuthShell
      title="Join Clemson RIDES"
      subtitle="Peace of mind, every ride. Rides and carpools for Clemson students."
      step={created ? 'Step 2 of 2' : 'Step 1 of 2'}
    >
      <GoogleContinue busy={googleBusy} disabled={busy} onClick={onGoogle} />
      <GameRideNote />
      {error && (
        <div id="signup-form-alert">
          <AccessibleAlert error={error} onDismiss={() => setError(null)} style={{ marginBottom: 12 }} />
        </div>
      )}
      <form noValidate onSubmit={onSubmit}>
        <p style={{ fontSize: 12, color: '#522D80', lineHeight: 1.4, marginBottom: 14 }}>
          A profile is required. The other person sees your name, bio, and ride style after a ride is accepted.
        </p>
        <label htmlFor="signup-fullname" style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Full name *</span>
          <input
            id="signup-fullname"
            type="text"
            autoComplete="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            aria-required="true"
            aria-invalid={fieldErrors.fullName ? 'true' : undefined}
            aria-describedby={fieldErrors.fullName ? 'signup-fullname-error' : undefined}
            style={fieldStyle}
            disabled={blocked}
          />
          {fieldErrors.fullName ? (
            <span id="signup-fullname-error" role="alert" className="field-error-text">
              {fieldErrors.fullName}
            </span>
          ) : null}
        </label>
        <label htmlFor="signup-phone" style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Mobile number *</span>
          <input
            id="signup-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="864-555-0100"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-required="true"
            aria-invalid={fieldErrors.phone ? 'true' : undefined}
            aria-describedby={fieldErrors.phone ? 'signup-phone-error' : undefined}
            style={fieldStyle}
            disabled={blocked}
          />
          {fieldErrors.phone ? (
            <span id="signup-phone-error" role="alert" className="field-error-text">
              {fieldErrors.phone}
            </span>
          ) : null}
        </label>
        <label htmlFor="signup-bio" style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Short bio *</span>
          <input
            id="signup-bio"
            type="text"
            placeholder="How you like to ride"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            aria-required="true"
            aria-invalid={fieldErrors.bio ? 'true' : undefined}
            aria-describedby={fieldErrors.bio ? 'signup-bio-error' : undefined}
            style={fieldStyle}
            disabled={blocked}
          />
          {fieldErrors.bio ? (
            <span id="signup-bio-error" role="alert" className="field-error-text">
              {fieldErrors.bio}
            </span>
          ) : null}
        </label>
        <div role="group" aria-labelledby="signup-ridestyle-label" style={{ marginBottom: 14 }}>
          <span id="signup-ridestyle-label" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Ride style *</span>
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
          {fieldErrors.rideStyle ? (
            <span id="signup-ridestyle-error" role="alert" className="field-error-text">
              {fieldErrors.rideStyle}
            </span>
          ) : null}
        </div>
        <label htmlFor="signup-email" style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>
            Email * <span id="signup-email-hint" style={{ fontWeight: 500, color: 'var(--ink-tertiary)' }}>(Clemson email gets student pricing)</span>
          </span>
          <input
            id="signup-email"
            type="email"
            autoComplete="email"
            placeholder="you@gmail.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-required="true"
            aria-invalid={fieldErrors.email ? 'true' : undefined}
            aria-describedby={fieldErrors.email ? 'signup-email-hint signup-email-error' : 'signup-email-hint'}
            style={fieldStyle}
            disabled={blocked}
          />
          {fieldErrors.email ? (
            <span id="signup-email-error" role="alert" className="field-error-text">
              {fieldErrors.email}
            </span>
          ) : null}
        </label>
        <label htmlFor="signup-password" style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>Password *</span>
          <input
            id="signup-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-required="true"
            aria-invalid={fieldErrors.password ? 'true' : undefined}
            aria-describedby={fieldErrors.password ? 'signup-password-error' : undefined}
            style={fieldStyle}
            disabled={blocked || created}
          />
          {fieldErrors.password ? (
            <span id="signup-password-error" role="alert" className="field-error-text">
              {fieldErrors.password}
            </span>
          ) : null}
        </label>
        {!gameLink && (
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
        )}
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
          <>
            <EmailCode email={email.trim()} />
            <button type="button" className="pressable lux-skip" onClick={() => { afterAuthSuccess().catch((err) => setError(err.message || 'Could not continue')) }}>
              Continue
            </button>
          </>
        ) : (
          <button type="submit" className="pressable primary-cta" disabled={blocked} style={{ width: '100%', padding: 16, borderRadius: 16, background: 'linear-gradient(135deg, var(--orange) 0%, #ff7a1a 100%)', color: '#fff', fontWeight: 700, fontSize: 16, boxShadow: 'var(--shadow-cta)', opacity: blocked ? 0.7 : 1 }}>
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
