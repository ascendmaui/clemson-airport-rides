import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { supabase, supabaseConfigured } from './supabase'
import { isClemsonEmail } from './studentDomain'

const AuthContext = createContext(null)

async function ensureProfile(user) {
  if (!supabase || !user?.id) return
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
  if (clemson) {
    row.student_verified_at = now
  }
  const { error } = await supabase.from('profiles').upsert(row, { onConflict: 'id' })
  if (error) console.warn('[auth] profile upsert', error.message)

  if (clemson) {
    const { error: svErr } = await supabase.from('student_verifications').upsert(
      {
        profile_id: user.id,
        email: user.email.trim().toLowerCase(),
        verified_at: now,
      },
      { onConflict: 'profile_id' },
    )
    // Unique on profile_id may not exist — fall back to insert-ignore style
    if (svErr) {
      const { data: existing } = await supabase
        .from('student_verifications')
        .select('id')
        .eq('profile_id', user.id)
        .maybeSingle()
      if (!existing) {
        const { error: insErr } = await supabase.from('student_verifications').insert({
          profile_id: user.id,
          email: user.email.trim().toLowerCase(),
          verified_at: now,
        })
        if (insErr) console.warn('[auth] student_verifications', insErr.message)
      } else {
        await supabase
          .from('student_verifications')
          .update({ email: user.email.trim().toLowerCase(), verified_at: now })
          .eq('profile_id', user.id)
      }
    }
  }
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
      if (error) throw error
      return data
    },
    async signUp(email, password, fullName) {
      if (!supabase) throw new Error('Supabase is not configured')
      if (!isClemsonEmail(email)) {
        throw new Error('Use your @clemson.edu email to join Clemson RIDES.')
      }
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName || '' } },
      })
      if (error) throw error
      if (data.user) await ensureProfile(data.user)
      return data
    },
    async signOut() {
      if (!supabase) return
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    },
  }), [session, user, loading])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
