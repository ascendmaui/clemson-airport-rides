import { authedJson } from './apiClient.js'
import { supabase } from './supabase.js'

export const PARTNER_INVITE_PATH = '/partners/join'

export function partnersApi(action, body) {
  return authedJson(supabase, `/api/partners?action=${encodeURIComponent(action)}`, body ? { method: 'POST', body } : {})
}

/** Upload one image/PDF to Supabase storage under the signed-in user's folder. */
export async function uploadRentalFile(file, { bucket = 'rental-photos', prefix = 'listing' } = {}) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { data: s } = await supabase.auth.getSession()
  const uid = s?.session?.user?.id
  if (!uid) throw new Error('Sign in first')
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
  const path = `${uid}/${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false, contentType: file.type || undefined })
  if (error) throw new Error(error.message)
  if (bucket === 'rental-photos') return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl
  return path
}

export const usd = (cents) => (cents == null ? '' : `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`)
