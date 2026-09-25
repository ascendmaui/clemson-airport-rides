/** Test double for src/lib/supabase.js. No network, no env, no real client. */
export const supabaseConfigured = false

export let supabase = null

export function setTestSupabase(client) {
  supabase = client
}

export async function pingSupabase() {
  return { ok: false, reason: 'stub' }
}

export async function fetchOnlineDrivers() {
  return []
}
