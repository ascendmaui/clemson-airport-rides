import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL || 'https://awktabuhijrshmsmagpq.supabase.co'
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF3a3RhYnVoaWpyc2htc21hZ3BxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1MTcxODAsImV4cCI6MjEwNTA5MzE4MH0.946mY5a9uLkawuVb4bKx-lrpvd8S0qucSPXuftzTRlU'

export const supabaseConfigured = Boolean(url && key)

export const supabase = supabaseConfigured
  ? createClient(url, key)
  : null

/** Light wiring — schema already exists; no migrations from this app. */
export async function pingSupabase() {
  if (!supabase) return { ok: false, reason: 'missing VITE_SUPABASE_ANON_KEY' }
  try {
    const { error } = await supabase.from('profiles').select('id').limit(1)
    if (error && error.code !== 'PGRST116') {
      return { ok: false, reason: error.message }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: String(e) }
  }
}
