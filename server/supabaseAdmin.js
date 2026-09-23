import { createClient } from '@supabase/supabase-js'

const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://awktabuhijrshmsmagpq.supabase.co'

export function adminClient() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!serviceKey || serviceKey.includes('placeholder')) return null
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function userFromAuth(req, sb) {
  if (!sb) return null
  const header = req.headers?.authorization || req.headers?.Authorization || ''
  const match = String(header).match(/^Bearer\s+(.+)$/i)
  if (!match) return null
  const { data, error } = await sb.auth.getUser(match[1])
  if (error || !data?.user) return null
  return data.user
}
