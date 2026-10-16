/** Web client for /api/ads. `deps` lets tests inject fetch and a token. */
import { supabase } from './supabase'

async function bearer() {
  if (!supabase) return null
  try {
    const { data } = await supabase.auth.getSession()
    return data?.session?.access_token || null
  } catch {
    return null
  }
}

export async function adsRequest(action, { method = 'GET', body, query = {}, headers = {}, auth = true, fetcher = globalThis.fetch, token } = {}) {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json', ...headers }
  const t = token !== undefined ? token : auth ? await bearer() : null
  if (t) h.Authorization = `Bearer ${t}`
  const params = new URLSearchParams({ action, ...query })
  const res = await fetcher(`/api/ads?${params}`, { method, headers: h, body: method === 'GET' ? undefined : JSON.stringify(body || {}) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`)
    err.status = res.status
    err.errors = data.errors || null
    throw err
  }
  return data
}

export const fetchAdPackages = (o) => adsRequest('packages', { auth: false, ...o })
export const submitAdSignup = (body, o) => adsRequest('signup', { method: 'POST', body, ...o })
export const fetchMyAds = (o) => adsRequest('mine', o)
export const fetchAdsAdmin = (o) => adsRequest('admin-overview', o)
export const adsAdmin = (action, body, o) => adsRequest(`admin-${action}`, { method: 'POST', body, ...o })

/** Upload a creative file straight to Supabase Storage with a signed URL from the API. */
export async function uploadAdCreative(file, o = {}) {
  const meta = await adsRequest('upload-url', { method: 'POST', body: { filename: file.name, contentType: file.type, size: file.size }, auth: false, ...o })
  const client = o.supabase || supabase
  if (!client) throw new Error('Uploads are offline right now.')
  const { error } = await client.storage.from('ad-creatives').uploadToSignedUrl(meta.path, meta.token, file, { contentType: file.type })
  if (error) throw new Error(error.message || 'Upload failed')
  return { path: meta.path, contentType: file.type, kind: meta.kind }
}
