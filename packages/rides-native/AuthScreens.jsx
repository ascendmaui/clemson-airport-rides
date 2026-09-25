import { useEffect, useRef, useState } from 'react'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import {
  getSignupRateLimitRemainingSec,
  isRateLimitError,
  markSignupRateLimited,
  normalizePromoCode,
} from './authErrors.js'
import {
  GOOGLE_SIGN_IN_COMING_SOON,
  googleAuthButtonState,
  mapGoogleAuthError,
} from './googleAuthConfig.js'
import { DANGER, INK, INK_SECONDARY, ORANGE, PURPLE, SURFACE } from './places.js'
import { SIGNUP_PROFILE_DRAFT_KEY, isProfileComplete, profileFieldError } from './partyProfile.js'
import { RideStyleChips } from './PartyScreens.jsx'

function AuthShell({ title, subtitle, mark, onBack, children }) {
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Pressable
          onPress={onBack}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Back"
          accessibilityHint="Goes back to previous screen"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityHint="Returns to the previous screen"
        >
          <Text style={styles.backLabel}>←</Text>
        </Pressable>
        <View style={styles.card}>
          <View style={styles.mark}>
            <Text style={styles.markLabel}>{mark}</Text>
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
          {children}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function SocialButtons({ providers, busyId, disabled, onPress }) {
  if (!providers?.length) return null
  const visible = providers.filter((p) => !p.hidden)
  if (!visible.length) return null

  return (
    <View style={styles.socialBlock}>
      {visible.map((provider) => {
        const isProviderDisabled = Boolean(disabled || busyId || provider.disabled)
        const pending = busyId === provider.id
        const honestCopy = provider.message || (provider.disabled ? GOOGLE_SIGN_IN_COMING_SOON : null)
        const labelText = pending
          ? 'Opening…'
          : provider.disabled
          ? (provider.disabledLabel || `Continue with ${provider.label} (coming soon)`)
          : `Continue with ${provider.label}`

        return (
          <Pressable
            key={provider.id}
            onPress={() => onPress(provider)}
            disabled={disabled || Boolean(busyId)}
            style={[styles.social, (disabled || busyId) && styles.disabled]}
            accessibilityRole="button"
            accessibilityLabel={`Continue with ${provider.label}`}
            accessibilityState={{ disabled: Boolean(disabled || busyId) }}
            accessibilityHint={`Signs in with ${provider.label}`}
            accessibilityState={{ disabled: disabled || Boolean(busyId), busy: pending }}
          >
            <Text style={styles.socialLabel}>{pending ? 'Opening…' : `Continue with ${provider.label}`}</Text>
          </Pressable>
          <View key={provider.id} style={styles.socialItem}>
            <Pressable
              onPress={() => onPress(provider)}
              disabled={isProviderDisabled}
              style={[
                styles.social,
                isProviderDisabled && styles.disabled,
                provider.disabled && styles.socialDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel={provider.disabled && honestCopy ? `${provider.label}: ${honestCopy}` : `Continue with ${provider.label}`}
              accessibilityState={{ disabled: isProviderDisabled }}
            >
              <Text
                style={[
                  styles.socialLabel,
                  provider.disabled && styles.socialLabelDisabled,
                ]}
              >
                {labelText}
              </Text>
            </Pressable>
            {provider.disabled && honestCopy ? (
              <Text style={styles.socialHint}>{honestCopy}</Text>
            ) : null}
          </View>
        )
      })}
      <Text style={styles.or}>or use email</Text>
    </View>
  )
}

function Field({ label, hint, ...inputProps }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>
        {label}
        {hint ? <Text style={styles.hint}> {hint}</Text> : null}
      </Text>
      <TextInput
        placeholderTextColor="#8B939E"
        style={styles.input}
        accessibilityLabel={label}
        {...inputProps}
      />
    </View>
  )
}

export function SignInScreen({
  signIn,
  onSuccess,
  onCreateAccount,
  onForgotPassword,
  onBack,
  subtitle = 'Sign in to book airport rides. Surge applies on busy hours and game days.',
  mark = 'CR',
  socialProviders,
  onSocial,
  resetPassword,
  onOpenLegal,
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState(false)
  const [socialId, setSocialId] = useState(null)
  const [resetBusy, setResetBusy] = useState(false)

  async function onSubmit() {
    setError(null)
    setBusy(true)
    try {
      await signIn(email.trim(), password)
      onSuccess?.()
    } catch (err) {
      setError(err?.message || 'Sign in failed')
    } finally {
      setBusy(false)
    }
  }

  const effectiveProviders = (socialProviders || []).map((provider) => {
    if (provider.id === 'google' && provider.disabled === undefined) {
      const gState = googleAuthButtonState()
      return {
        ...provider,
        disabled: gState.disabled,
        hidden: gState.hidden,
        message: gState.message,
        disabledLabel: `Continue with ${provider.label} (coming soon)`,
      }
    }
    return provider
  })

  async function onSocialPress(provider) {
    if (!onSocial || busy || socialId || provider?.disabled) return
    setError(null)
    setInfo(null)
    setSocialId(provider.id)
    try {
      const result = await onSocial(provider.id)
      if (result?.cancelled) return
      onSuccess?.()
    } catch (err) {
      const mapped = provider.id === 'google' ? mapGoogleAuthError(err) : err
      setError(mapped?.message || 'Social sign-in failed')
    } finally {
      setSocialId(null)
    }
  }

  async function onForgot() {
    if (!resetPassword || resetBusy) return
    setError(null)
    setInfo(null)
    setResetBusy(true)
    try {
      await resetPassword(email.trim())
      setInfo('Check your email for a link to choose a new password.')
    } catch (err) {
      setError(err?.message || 'Could not send a reset email')
    } finally {
      setResetBusy(false)
    }
  }

  return (
    <AuthShell title="Welcome back" subtitle={subtitle} mark={mark} onBack={onBack}>
      <SocialButtons
        providers={effectiveProviders}
        busyId={socialId}
        disabled={busy || resetBusy}
        onPress={onSocialPress}
      />
      <Field
        label="Email"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        value={email}
        onChangeText={setEmail}
      />
      <Field
        label="Password"
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        value={password}
        onChangeText={setPassword}
      />
      {onForgotPassword ? (
        <Pressable
          onPress={onForgotPassword}
          accessibilityRole="button"
          accessibilityLabel="Forgot password?"
          accessibilityHint="Navigates to password reset"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityHint="Opens password reset"
          hitSlop={14}
        >
          <Text style={styles.forgot}>Forgot password?</Text>
        </Pressable>
      ) : resetPassword ? (
        <Pressable
          onPress={onForgot}
          disabled={resetBusy}
          accessibilityRole="button"
          accessibilityLabel="Forgot password?"
          accessibilityHint="Sends password reset instructions to your email"
          accessibilityState={{ disabled: resetBusy }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityHint="Emails a link to choose a new password"
          accessibilityState={{ disabled: resetBusy, busy: resetBusy }}
          hitSlop={14}
        >
          <Text style={styles.forgot}>{resetBusy ? 'Sending reset email…' : 'Forgot password?'}</Text>
        </Pressable>
      ) : null}
      {error ? <Text style={styles.error} accessibilityLiveRegion="assertive" accessibilityRole="alert">{error}</Text> : null}
      {info ? <Text style={styles.info} accessibilityLiveRegion="polite">{info}</Text> : null}
      <Pressable
        onPress={onSubmit}
        disabled={busy || !email.trim() || !password}
        style={[styles.primary, (busy || !email.trim() || !password) && styles.disabled]}
        accessibilityRole="button"
        accessibilityLabel={busy ? 'Signing in…' : 'Sign in'}
        accessibilityState={{ disabled: Boolean(busy || !email.trim() || !password) }}
        accessibilityLabel={busy ? 'Signing in' : 'Sign in'}
        accessibilityState={{ disabled: busy || !email.trim() || !password, busy }}
      >
        <Text style={styles.primaryLabel}>{busy ? 'Signing in…' : 'Sign in'}</Text>
      </Pressable>
      <Text style={styles.switchRow}>
        New here?{' '}
        <Text
          onPress={onCreateAccount}
          style={styles.switch}
          accessibilityRole="link"
          accessibilityLabel="Create an account"
          accessibilityHint="Opens sign up"
          hitSlop={12}
        >
          Create an account
        </Text>
      </Text>
      <LegalLinks onOpenLegal={onOpenLegal} />
    </AuthShell>
  )
}

function LegalLinks({ onOpenLegal }) {
  if (!onOpenLegal) return null
  return (
    <Text style={styles.switchRow}>
      <Text onPress={() => onOpenLegal('privacy')} style={styles.switch} accessibilityRole="link" accessibilityLabel="Privacy" hitSlop={12}>Privacy</Text>
      {' · '}
      <Text onPress={() => onOpenLegal('terms')} style={styles.switch} accessibilityRole="link" accessibilityLabel="Terms" hitSlop={12}>Terms</Text>
    </Text>
  )
}

export function SignUpScreen({
  signUp,
  storage,
  onSuccess,
  onSignIn,
  onBack,
  initialPromo = '',
  subtitle = 'Metered fares to GSP and CLT. Students save 10% on Standard.',
  mark = 'CR',
  showPromo = true,
  socialProviders,
  onSocial,
  onOpenLegal,
}) {
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [bio, setBio] = useState('')
  const [rideStyle, setRideStyle] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [promo, setPromo] = useState(initialPromo)
  const [error, setError] = useState(null)
  const [info, setInfo] = useState(null)
  const [created, setCreated] = useState(false)
  const [accountExists, setAccountExists] = useState(false)
  const [busy, setBusy] = useState(false)
  const [socialId, setSocialId] = useState(null)
  const [cooldownSec, setCooldownSec] = useState(0)
  const submitLock = useRef(false)

  useEffect(() => {
    let alive = true
    getSignupRateLimitRemainingSec(storage).then((left) => {
      if (alive) setCooldownSec(left)
    })
    return () => {
      alive = false
    }
  }, [storage])

  useEffect(() => {
    if (cooldownSec <= 0) return undefined
    const id = setInterval(() => {
      getSignupRateLimitRemainingSec(storage).then((left) => {
        setCooldownSec(left)
        if (left <= 0) clearInterval(id)
      })
    }, 250)
    return () => clearInterval(id)
  }, [cooldownSec, storage])

  async function onSubmit() {
    if (created || submitLock.current || busy) return
    const left = await getSignupRateLimitRemainingSec(storage)
    if (left > 0) {
      setCooldownSec(left)
      setError(`Too many signup emails just now. Try again in ${left}s, or sign in if you already created an account.`)
      return
    }
    setError(null)
    setInfo(null)
    setAccountExists(false)
    submitLock.current = true
    setBusy(true)
    try {
      const profile = { phone, bio, rideStyle }
      if (storage) {
        try {
          await storage.setItem(SIGNUP_PROFILE_DRAFT_KEY, JSON.stringify({
            fullName: fullName.trim(),
            phone,
            bio,
            rideStyle,
            promo,
          }))
        } catch {
          /* signup metadata still carries the profile */
        }
      }
      const result = await signUp(email.trim(), password, fullName.trim(), promo, profile)
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
      onSuccess?.()
    } catch (err) {
      if (isRateLimitError(err)) {
        const retry = err.retryAfterSec || left || 60
        await markSignupRateLimited(storage, retry)
        const shown = (await getSignupRateLimitRemainingSec(storage)) || retry
        setCooldownSec(shown)
        setError(`Too many signup emails just now. Try again in ${shown}s, or sign in if you already created an account.`)
      } else {
        setAccountExists(err?.code === 'account_exists')
        setError(err?.message || 'Sign up failed')
      }
    } finally {
      setBusy(false)
      submitLock.current = false
    }
  }

  const effectiveProviders = (socialProviders || []).map((provider) => {
    if (provider.id === 'google' && provider.disabled === undefined) {
      const gState = googleAuthButtonState()
      return {
        ...provider,
        disabled: gState.disabled,
        hidden: gState.hidden,
        message: gState.message,
        disabledLabel: `Continue with ${provider.label} (coming soon)`,
      }
    }
    return provider
  })

  async function onSocialPress(provider) {
    if (!onSocial || blocked || socialId || created || provider?.disabled) return
    setError(null)
    setInfo(null)
    setSocialId(provider.id)
    try {
      if (storage) {
        try {
          await storage.setItem(SIGNUP_PROFILE_DRAFT_KEY, JSON.stringify({
            fullName: fullName.trim(),
            phone,
            bio,
            rideStyle,
            promo,
          }))
        } catch {
          /* the profile screen still asks if this draft is missing */
        }
      }
      const result = await onSocial(provider.id, { promo, fullName })
      if (result?.cancelled) return
      onSuccess?.()
    } catch (err) {
      const mapped = provider.id === 'google' ? mapGoogleAuthError(err) : err
      setError(mapped?.message || 'Social sign-in failed')
    } finally {
      setSocialId(null)
    }
  }

  const cta = busy ? 'Creating…' : cooldownSec > 0 ? `Wait ${cooldownSec}s…` : 'Create account'
  const profileReady = isProfileComplete({ full_name: fullName, phone, bio, ride_style: rideStyle })
  const canSubmit = !blocked && !created && profileReady && email.trim() && password.length >= 6
  const profileHint = profileFieldError({ full_name: fullName, phone, bio, ride_style: rideStyle })

  return (
    <AuthShell title="Join Clemson RIDES" subtitle={subtitle} mark={mark} onBack={onBack}>
      <SocialButtons
        providers={effectiveProviders}
        busyId={socialId}
        disabled={blocked || created}
        onPress={onSocialPress}
      />
      <Text style={styles.promoNote}>
        A profile is required. Name, mobile number, a short bio, and ride style are saved with this account. The other person sees them after a ride is accepted.
      </Text>
      <Field label="Full name" autoComplete="name" textContentType="name" value={fullName} onChangeText={setFullName} editable={!blocked} />
      <Field
        label="Mobile number"
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        placeholder="864-555-0100"
        value={phone}
        onChangeText={setPhone}
        editable={!blocked}
      />
      <Field
        label="Short bio"
        placeholder="How you like to ride"
        value={bio}
        onChangeText={setBio}
        editable={!blocked}
      />
      <Text style={styles.label}>Ride style</Text>
      <View style={{ marginBottom: 14 }}>
        <RideStyleChips value={rideStyle} onChange={setRideStyle} />
      </View>
      <Field
        label="Email"
        hint="(Clemson email gets student pricing)"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        placeholder="you@gmail.com"
        value={email}
        onChangeText={setEmail}
        editable={!blocked}
      />
      <Field
        label="Password"
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        value={password}
        onChangeText={setPassword}
        editable={!blocked && !created}
      />
      {showPromo ? (
        <>
          <Field
            label="Promo code"
            hint="(optional)"
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="Friend's code"
            value={promo}
            onChangeText={(value) => setPromo(normalizePromoCode(value))}
            editable={!blocked && !created}
          />
          <Text style={styles.promoNote}>
            Applied when you create the account. You and your friend are rewarded only after you complete your first ride.
          </Text>
        </>
      ) : null}
      {!created && profileHint ? <Text style={styles.cooldown}>{profileHint}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {accountExists ? (
        <Pressable
          onPress={onSignIn}
          style={styles.primary}
          accessibilityRole="button"
          accessibilityLabel="Sign in"
          accessibilityHint="Navigates to sign in screen"
        >
          <Text style={styles.primaryLabel}>Sign in</Text>
        </Pressable>
      ) : null}
      {info ? <Text style={styles.info}>{info}</Text> : null}
      {cooldownSec > 0 && !error ? (
        <Text style={styles.cooldown}>Email send limit cooling down — retry in {cooldownSec}s.</Text>
      ) : null}
      {created ? (
        <Pressable
          onPress={onSuccess}
          style={styles.primary}
          accessibilityRole="button"
          accessibilityLabel="Continue"
          accessibilityHint="Proceeds to next step"
        >
          <Text style={styles.primaryLabel}>Continue</Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={onSubmit}
          disabled={!canSubmit}
          style={[styles.primary, !canSubmit && styles.disabled]}
          accessibilityRole="button"
          accessibilityLabel={cta}
          accessibilityState={{ disabled: !canSubmit }}
        >
          <Text style={styles.primaryLabel}>{cta}</Text>
        </Pressable>
      )}
      <Text style={styles.switchRow}>
        Already have an account?{' '}
        <Text onPress={onSignIn} style={styles.switch}>Sign in</Text>
      </Text>
      <LegalLinks onOpenLegal={onOpenLegal} />
    </AuthShell>
  )
}

export function ForgotPasswordScreen({
  resetPassword,
  onBack,
  onSignIn,
  mark = 'CR',
  sentDetail = 'Check your email for a reset link. It opens this app with the clemsonrides://set-password link.',
}) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState(null)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  async function onSubmit() {
    setError(null)
    setBusy(true)
    try {
      await resetPassword(email.trim())
      setSent(true)
    } catch (err) {
      setError(err?.message || 'Could not send reset email')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell
      title="Forgot password"
      subtitle="We'll email a reset link that opens Clemson RIDES so you can choose a new password."
      mark={mark}
      onBack={onBack}
    >
      <Field
        label="Email"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        value={email}
        onChangeText={setEmail}
        editable={!sent}
      />
      {sent ? (
        <Text style={styles.info}>
          Check {email.trim()}. {sentDetail}
        </Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {sent ? (
        <Pressable
          onPress={onSignIn}
          style={styles.primary}
          accessibilityRole="button"
          accessibilityLabel="Back to sign in"
          accessibilityHint="Navigates back to sign in"
        >
          <Text style={styles.primaryLabel}>Back to sign in</Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={onSubmit}
          disabled={busy || !email.trim()}
          style={[styles.primary, (busy || !email.trim()) && styles.disabled]}
          accessibilityRole="button"
          accessibilityLabel={busy ? 'Sending…' : 'Email reset link'}
          accessibilityState={{ disabled: Boolean(busy || !email.trim()) }}
        >
          <Text style={styles.primaryLabel}>{busy ? 'Sending…' : 'Email reset link'}</Text>
        </Pressable>
      )}
    </AuthShell>
  )
}

export function SetNewPasswordScreen({
  updatePassword,
  onSuccess,
  onBack,
  ready = true,
  statusNote = null,
  mark = 'CR',
}) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit() {
    if (password.length < 6) {
      setError('Use at least 6 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setError(null)
    setBusy(true)
    try {
      await updatePassword(password)
      onSuccess?.()
    } catch (err) {
      setError(err?.message || 'Could not update password')
    } finally {
      setBusy(false)
    }
  }

  const canSubmit = ready && !busy && password.length >= 6 && password === confirm

  return (
    <AuthShell
      title="Set a new password"
      subtitle="This replaces the password on your Supabase account."
      mark={mark}
      onBack={onBack}
    >
      {statusNote ? <Text style={styles.info}>{statusNote}</Text> : null}
      <Field
        label="New password"
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        value={password}
        onChangeText={setPassword}
      />
      <Field
        label="Confirm password"
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        value={confirm}
        onChangeText={setConfirm}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        onPress={onSubmit}
        disabled={!canSubmit}
        style={[styles.primary, !canSubmit && styles.disabled]}
        accessibilityRole="button"
        accessibilityLabel={busy ? 'Saving…' : 'Update password'}
        accessibilityState={{ disabled: !canSubmit }}
      >
        <Text style={styles.primaryLabel}>{busy ? 'Saving…' : 'Update password'}</Text>
      </Pressable>
    </AuthShell>
  )
}

export function ResetPasswordScreen({
  updatePassword,
  onSuccess,
  onBack,
  subtitle = 'Choose a new password for the email on this account.',
  mark = 'CR',
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit() {
    setError(null)
    setBusy(true)
    try {
      await updatePassword(password)
      onSuccess?.()
    } catch (err) {
      setError(err?.message || 'Could not update the password')
    } finally {
      setBusy(false)
    }
  }

  const canSubmit = !busy && password.length >= 6

  return (
    <AuthShell title="New password" subtitle={subtitle} mark={mark} onBack={onBack}>
      <Field
        label="New password"
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        value={password}
        onChangeText={setPassword}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable
        onPress={onSubmit}
        disabled={!canSubmit}
        style={[styles.primary, !canSubmit && styles.disabled]}
        accessibilityRole="button"
        accessibilityLabel={busy ? 'Saving…' : 'Save password'}
        accessibilityState={{ disabled: !canSubmit }}
      >
        <Text style={styles.primaryLabel}>{busy ? 'Saving…' : 'Save password'}</Text>
      </Pressable>
    </AuthShell>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SURFACE },
  scroll: { flexGrow: 1, padding: 24, paddingTop: 56, justifyContent: 'center' },
  back: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.72)',
    marginBottom: 12,
  },
  backLabel: { fontSize: 18, color: PURPLE, fontWeight: '700' },
  card: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 24,
    padding: 28,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(82,45,128,0.12)',
    // Subtle Clemson-purple shadow (iOS) + Android elevation
    shadowColor: PURPLE,
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  mark: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  markLabel: { color: '#fff', fontWeight: '800', fontSize: 16 },
  title: { fontSize: 24, fontWeight: '700', color: PURPLE, marginBottom: 6 },
  subtitle: { color: INK_SECONDARY, fontSize: 14, lineHeight: 20, marginBottom: 22 },
  field: { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '600', color: INK_SECONDARY, marginBottom: 6 },
  hint: { fontWeight: '500', color: '#8B939E' },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(82,45,128,0.18)',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: INK,
  },
  socialBlock: { marginBottom: 8 },
  socialItem: { marginBottom: 10 },
  social: {
    borderWidth: 1,
    borderColor: 'rgba(82,45,128,0.22)',
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  socialDisabled: {
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderColor: 'rgba(139,147,158,0.25)',
  },
  socialLabel: { color: PURPLE, fontWeight: '700', fontSize: 15 },
  socialLabelDisabled: {
    color: '#8B939E',
    fontWeight: '600',
  },
  socialHint: {
    color: INK_SECONDARY,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 16,
  },
  or: { textAlign: 'center', color: INK_SECONDARY, fontSize: 13, marginTop: 4, marginBottom: 16 },
  forgot: { color: PURPLE, fontWeight: '700', fontSize: 13, marginBottom: 14 },
  promoNote: { color: PURPLE, fontSize: 12, lineHeight: 17, marginBottom: 14 },
  error: { color: DANGER, fontSize: 13, marginBottom: 12, lineHeight: 18 },
  info: { color: PURPLE, fontSize: 13, marginBottom: 12, lineHeight: 18 },
  cooldown: { color: INK_SECONDARY, fontSize: 13, marginBottom: 12 },
  primary: {
    backgroundColor: ORANGE,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  disabled: { opacity: 0.55 },
  primaryLabel: { color: '#fff', fontWeight: '700', fontSize: 16 },
  switchRow: { marginTop: 18, textAlign: 'center', color: INK_SECONDARY, fontSize: 14 },
  switch: { color: PURPLE, fontWeight: '700' },
})
