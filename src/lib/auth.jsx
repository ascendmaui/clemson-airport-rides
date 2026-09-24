import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase, supabaseConfigured } from './supabase'
import { isClemsonEmail } from './studentDomain'
import { maybeClaimStoredPromo } from './riderReferral'
import { normalizePromoCode } from './riderPromo'
import { buildEnsureProfilePatch, signupProfileMetadata } from '../../packages/rides-native/partyProfile.js'

const AuthContext = createContext(null)

export const SIGNUP_RATE_LIMIT_COOLDOWN_SEC = 60
export const SIGNUP_RATE_LIMIT_STORAGE_KEY = 'clemson_signup_rate_limit_until'

const RATE_LIMIT_MSG =
  'Too many signup emails just now. Wait a minute and try again, or sign in if you already created an account.'

export function isRateLimitError(error) {
  const msg = error?.message || ''
  const status = error?.status
  return (
    status === 429 ||
    /rate limit|over_email_send_rate_limit|email rate|too many signup emails/i.test(msg)
  )
}

export function mapAuthError(error) {
  if (isRateLimitError(error)) {
    const err = new Error(RATE_LIMIT_MSG)
    err.code = 'over_email_send_rate_limit'
    err.status = 429
    err.retryAfterSec = SIGNUP_RATE_LIMIT_COOLDOWN_SEC
    return err
  }
  return error instanceof Error ? error : new Error(error?.message || 'Auth failed')
}

export function markSignupRateLimited(retryAfterSec = SIGNUP_RATE_LIMIT_COOLDOWN_SEC) {
  if (typeof window === 'undefined') return
  const until = Date.now() + Math.max(1, Number(retryAfterSec) || SIGNUP_RATE_LIMIT_COOLDOWN_SEC) * 1000
  try {
    window.sessionStorage.setItem(SIGNUP_RATE_LIMIT_STORAGE_KEY, String(until))
  } catch {
    /* ignore */
  }
}

export function getSignupRateLimitRemainingSec() {
  if (typeof window === 'undefined') return 0
  try {
    const until = Number(window.sessionStorage.getItem(SIGNUP_RATE_LIMIT_STORAGE_KEY) || 0)
    if (!until) return 0
    const left = Math.ceil((until - Date.now()) / 1000)
    if (left <= 0) {
      window.sessionStorage.removeItem(SIGNUP_RATE_LIMIT_STORAGE_KEY)
      return 0
    }
    return left
  } catch {
    return 0
  }
}

async function ensureStudentVerification(user, now) {
  if (!supabase || !user?.id || !user.email) return
  const email = user.email.trim().toLowerCase()
  // Unique on profile_id (migration student_verifications_profile_id_unique)
  const { error } = await supabase.from('student_verifications').upsert(
    { profile_id: user.id, email, verified_at: now },
    { onConflict: 'profile_id' },
  )
  if (!error) return
  // Fallback if schema lag: select → insert/update (never spam 400s)
  const { data: existing } = await supabase
    .from('student_verifications')
    .select('id')
    .eq('profile_id', user.id)
    .maybeSingle()
  if (existing?.id) {
    const { error: upErr } = await supabase
      .from('student_verifications')
      .update({ email, verified_at: now })
      .eq('profile_id', user.id)
    if (upErr) console.warn('[auth] student_verifications update', upErr.message)
  } else {
    const { error: insErr } = await supabase.from('student_verifications').insert({
      profile_id: user.id,
      email,
      verified_at: now,
    })
    if (insErr) console.warn('[auth] student_verifications insert', insErr.message)
  }
}

async function ensureProfile(user, { promoCode } = {}) {
  if (!supabase || !user?.id) return null
  const now = new Date().toISOString()
  const clemson = isClemsonEmail(user.email)
  let existing = null
  const existingRes = await supabase
    .from('profiles')
    .select('id, full_name, phone, bio, ride_style, student_verified_at')
    .eq('id', user.id)
    .maybeSingle()
  if (existingRes.error && /column|schema cache/i.test(existingRes.error.message || '')) {
    const basic = await supabase.from('profiles').select('id, full_name').eq('id', user.id).maybeSingle()
    existing = basic.data
  } else if (!existingRes.error) {
    existing = existingRes.data
  }
  const patch = buildEnsureProfilePatch(existing, user, now, clemson)
  let { error } = await supabase.from('profiles').upsert(patch, { onConflict: 'id' })
  if (error && /column|schema cache/i.test(error.message || '')) {
    const minimal = {
      id: user.id,
      email: user.email || null,
      full_name: patch.full_name || existing?.full_name || (user.email ? user.email.split('@')[0] : 'Rider'),
      updated_at: now,
    }
    const retry = await supabase.from('profiles').upsert(minimal, { onConflict: 'id' })
    error = retry.error
  }
  if (error) console.warn('[auth] profile upsert', error.message)

  if (clemson) await ensureStudentVerification(user, now)

  // Code entered at signup. Claim stores referred_by / promo and status pending.
  // It does not grant credits — those wait for the first completed ride.
  const code = normalizePromoCode(promoCode || user?.user_metadata?.promo_code)
  if (!code) return null
  return maybeClaimStoredPromo(user, code)
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabaseConfigured || !supabase) {
      setLoading(false)
      return undefined
    }
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      setSession(data.session)
      setUser(data.session?.user ?? null)
      setLoading(false)
      if (data.session?.user) ensureProfile(data.session.user)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setUser(next?.user ?? null)
      setLoading(false)
      if (next?.user) ensureProfile(next.user)
    })
    return () => {
      alive = false
      sub?.subscription?.unsubscribe?.()
    }
  }, [])

  const value = useMemo(() => ({
    session,
    user,
    loading,
    configured: supabaseConfigured,
    async signIn(email, password) {
      if (!supabase) throw new Error('Supabase is not configured')
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw mapAuthError(error)
      return data
    },
    async signUp(email, password, fullName, promoCode, profile) {
      if (!supabase) throw new Error('Supabase is not configured')
      const remaining = getSignupRateLimitRemainingSec()
      if (remaining > 0) {
        const err = mapAuthError({ status: 429, message: 'rate limit' })
        err.retryAfterSec = remaining
        throw err
      }
      const code = normalizePromoCode(promoCode)
      const meta = signupProfileMetadata({
        fullName,
        phone: profile?.phone,
        bio: profile?.bio,
        rideStyle: profile?.rideStyle,
        promoCode: code,
      })
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: meta },
      })
      if (error) {
        const mapped = mapAuthError(error)
        if (mapped.code === 'over_email_send_rate_limit') {
          markSignupRateLimited(mapped.retryAfterSec)
        }
        throw mapped
      }
      let promoClaim = null
      if (data.user) promoClaim = await ensureProfile(data.user, { promoCode: code })
      return { ...data, promoClaim }
    },
    async signOut() {
      if (!supabase) return
      const { error } = await supabase.auth.signOut()
      if (error) throw mapAuthError(error)
    },
  }), [session, user, loading])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
