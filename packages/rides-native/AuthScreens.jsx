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
import { DANGER, INK, INK_SECONDARY, ORANGE, PURPLE, SURFACE } from './places.js'

function AuthShell({ title, subtitle, mark, onBack, children }) {
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Pressable onPress={onBack} style={styles.back} accessibilityRole="button">
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
  return (
    <View style={styles.socialBlock}>
      {providers.map((provider) => {
        const pending = busyId === provider.id
        return (
          <Pressable
            key={provider.id}
            onPress={() => onPress(provider)}
            disabled={disabled || Boolean(busyId)}
            style={[styles.social, (disabled || busyId) && styles.disabled]}
            accessibilityRole="button"
            accessibilityLabel={`Continue with ${provider.label}`}
          >
            <Text style={styles.socialLabel}>{pending ? 'Opening…' : `Continue with ${provider.label}`}</Text>
          </Pressable>
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
        {...inputProps}
      />
    </View>
  )
}

export function SignInScreen({
  signIn,
  onSuccess,
  onCreateAccount,
  onBack,
  subtitle = 'Sign in to book airport rides. Surge applies on busy hours and game days.',
  mark = 'CR',
  socialProviders,
  onSocial,
  resetPassword,
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

  async function onSocialPress(provider) {
    if (!onSocial || busy || socialId) return
    setError(null)
    setInfo(null)
    setSocialId(provider.id)
    try {
      const result = await onSocial(provider.id)
      if (result?.cancelled) return
      onSuccess?.()
    } catch (err) {
      setError(err?.message || 'Social sign-in failed')
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
        providers={socialProviders}
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
      {resetPassword ? (
        <Pressable onPress={onForgot} disabled={resetBusy} accessibilityRole="button">
          <Text style={styles.forgot}>{resetBusy ? 'Sending reset email…' : 'Forgot password?'}</Text>
        </Pressable>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {info ? <Text style={styles.info}>{info}</Text> : null}
      <Pressable
        onPress={onSubmit}
        disabled={busy || !email.trim() || !password}
        style={[styles.primary, (busy || !email.trim() || !password) && styles.disabled]}
        accessibilityRole="button"
      >
        <Text style={styles.primaryLabel}>{busy ? 'Signing in…' : 'Sign in'}</Text>
      </Pressable>
      <Text style={styles.switchRow}>
        New here?{' '}
        <Text onPress={onCreateAccount} style={styles.switch}>Create an account</Text>
      </Text>
    </AuthShell>
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
  socialProviders,
  onSocial,
}) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [promo, setPromo] = useState(initialPromo)
  const [error, setError] = useState(null)
  const [info, setInfo] = useState(null)
  const [created, setCreated] = useState(false)
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
    submitLock.current = true
    setBusy(true)
    try {
      const result = await signUp(email.trim(), password, fullName.trim(), promo)
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
        setError(err?.message || 'Sign up failed')
      }
    } finally {
      setBusy(false)
      submitLock.current = false
    }
  }

  const blocked = busy || cooldownSec > 0

  async function onSocialPress(provider) {
    if (!onSocial || blocked || socialId || created) return
    setError(null)
    setInfo(null)
    setSocialId(provider.id)
    try {
      const result = await onSocial(provider.id, { promo, fullName })
      if (result?.cancelled) return
      onSuccess?.()
    } catch (err) {
      setError(err?.message || 'Social sign-in failed')
    } finally {
      setSocialId(null)
    }
  }

  const cta = busy ? 'Creating…' : cooldownSec > 0 ? `Wait ${cooldownSec}s…` : 'Create account'
  const canSubmit = !blocked && !created && fullName.trim() && email.trim() && password.length >= 6

  return (
    <AuthShell title="Join Clemson RIDES" subtitle={subtitle} mark={mark} onBack={onBack}>
      <SocialButtons
        providers={socialProviders}
        busyId={socialId}
        disabled={blocked || created}
        onPress={onSocialPress}
      />
      <Field label="Full name" autoComplete="name" textContentType="name" value={fullName} onChangeText={setFullName} editable={!blocked} />
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
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {info ? <Text style={styles.info}>{info}</Text> : null}
      {cooldownSec > 0 && !error ? (
        <Text style={styles.cooldown}>Email send limit cooling down — retry in {cooldownSec}s.</Text>
      ) : null}
      {created ? (
        <Pressable onPress={onSuccess} style={styles.primary} accessibilityRole="button">
          <Text style={styles.primaryLabel}>Continue</Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={onSubmit}
          disabled={!canSubmit}
          style={[styles.primary, !canSubmit && styles.disabled]}
          accessibilityRole="button"
        >
          <Text style={styles.primaryLabel}>{cta}</Text>
        </Pressable>
      )}
      <Text style={styles.switchRow}>
        Already have an account?{' '}
        <Text onPress={onSignIn} style={styles.switch}>Sign in</Text>
      </Text>
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
  social: {
    borderWidth: 1,
    borderColor: 'rgba(82,45,128,0.22)',
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  socialLabel: { color: PURPLE, fontWeight: '700', fontSize: 15 },
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
