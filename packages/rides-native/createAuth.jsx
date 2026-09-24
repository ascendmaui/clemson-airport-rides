import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  getSignupRateLimitRemainingSec,
  isClemsonEmail,
  mapAuthError,
  markSignupRateLimited,
  normalizePromoCode,
  PROMO_CLAIM_STATE_KEY,
} from './authErrors.js'
import { requestPasswordReset, signInWithEmail, updatePassword } from './emailAuth.js'
import { PASSWORD_RESET_REDIRECT } from './riderShell.js'

async function ensureStudentVerification(supabase, user, now) {
  if (!supabase || !user?.id || !user.email) return
  const email = user.email.trim().toLowerCase()
  const { error } = await supabase.from('student_verifications').upsert(
    { profile_id: user.id, email, verified_at: now },
    { onConflict: 'profile_id' },
  )
  if (!error) return
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

async function maybeClaimStoredPromo(supabase, storage, user, promoCode) {
  if (!supabase || !user?.id) return null
  const { data: sessionData } = await supabase.auth.getSession()
  if (!sessionData?.session) return null
  const code = normalizePromoCode(promoCode || user?.user_metadata?.promo_code)
  if (!code) return null

  let prev = ''
  try {
    prev = (await storage.getItem(PROMO_CLAIM_STATE_KEY)) || ''
  } catch {
    prev = ''
  }
  if (prev === `${user.id}:ok` || prev === `${user.id}:bad`) return null

  try {
    const { data, error } = await supabase.rpc('claim_rider_social_promo', { p_code: code })
    if (error) throw new Error(error.message)
    const res = data || { ok: false, error: 'Promo claim failed' }
    const bad = Boolean(res?.error)
    const done = res?.claimed || res?.reason === 'already_referred' || bad
    if (done) {
      try {
        await storage.setItem(PROMO_CLAIM_STATE_KEY, `${user.id}:${bad ? 'bad' : 'ok'}`)
      } catch {
        /* ignore */
      }
    }
    return res
  } catch (e) {
    console.warn('[promo claim]', e.message)
    return null
  }
}

async function ensureProfile(supabase, storage, user, { promoCode } = {}) {
  if (!supabase || !user?.id) return null
  const fullName =
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    (user.email ? user.email.split('@')[0] : 'Rider')
  const now = new Date().toISOString()
  const clemson = isClemsonEmail(user.email)
  const row = {
    id: user.id,
    email: user.email || null,
    full_name: fullName,
    updated_at: now,
  }
  if (clemson) row.student_verified_at = now
  const { error } = await supabase.from('profiles').upsert(row, { onConflict: 'id' })
  if (error) console.warn('[auth] profile upsert', error.message)
  if (clemson) await ensureStudentVerification(supabase, user, now)
  const code = normalizePromoCode(promoCode || user?.user_metadata?.promo_code)
  if (!code) return null
  return maybeClaimStoredPromo(supabase, storage, user, code)
}

export function createAuth({
  supabase,
  supabaseConfigured,
  storage,
  passwordResetRedirectTo,
  onSignOut,
  onPasswordRecovery,
}) {
  const AuthContext = createContext(null)

  function AuthProvider({ children }) {
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
        if (data.session?.user) ensureProfile(supabase, storage, data.session.user)
      })
      const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
        setSession(next)
        setUser(next?.user ?? null)
        setLoading(false)
        if (next?.user) ensureProfile(supabase, storage, next.user)
        if (event === 'PASSWORD_RECOVERY') onPasswordRecovery?.()
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
        return signInWithEmail(supabase, email, password)
      },
      async resetPassword(email, redirectTo = passwordResetRedirectTo || PASSWORD_RESET_REDIRECT) {
        return requestPasswordReset(supabase, email, redirectTo)
      },
      async updatePassword(password) {
        return updatePassword(supabase, password)
      },
      async signUp(email, password, fullName, promoCode) {
        if (!supabase) throw new Error('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_ANON_KEY for this EAS build.')
        const remaining = await getSignupRateLimitRemainingSec(storage)
        if (remaining > 0) {
          const err = mapAuthError({ status: 429, message: 'rate limit' })
          err.retryAfterSec = remaining
          throw err
        }
        const code = normalizePromoCode(promoCode)
        const meta = { full_name: fullName || '' }
        if (code) meta.promo_code = code
        const { data, error } = await supabase.auth.signUp({
          email: String(email || '').trim(),
          password,
          options: { data: meta },
        })
        if (error) {
          const mapped = mapAuthError(error)
          if (mapped.code === 'over_email_send_rate_limit') {
            await markSignupRateLimited(storage, mapped.retryAfterSec)
          }
          throw mapped
        }
        let promoClaim = null
        if (data.user) promoClaim = await ensureProfile(supabase, storage, data.user, { promoCode: code })
        return { ...data, promoClaim }
      },
      async signOut() {
        if (supabase) {
          const { error } = await supabase.auth.signOut()
          if (error) throw mapAuthError(error)
        }
        if (onSignOut) await onSignOut()
      },
    }), [session, user, loading])

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  }

  function useAuth() {
    const ctx = useContext(AuthContext)
    if (!ctx) throw new Error('useAuth must be used within AuthProvider')
    return ctx
  }

  return { AuthProvider, useAuth }
}
