/** Web client for the affiliate program (/api/affiliates). */
import { authedJson } from './apiClient'
import { supabase } from './supabase'
import { normalizeAffiliateCode } from '../../shared/affiliates/rules.js'

const DEVICE_KEY = 'clemson_device_id'
const REF_KEY = 'clemson_affiliate_ref'
const API = '/api/affiliates'

function store() {
  try { return window.localStorage } catch { return null }
}

export function deviceId() {
  const s = store()
  let id = s?.getItem(DEVICE_KEY)
  if (!id) {
    id = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`)
    s?.setItem(DEVICE_KEY, id)
  }
  return id
}

export function rememberAffiliateRef(code, role = 'rider') {
  const c = normalizeAffiliateCode(code)
  if (!c) return
  // First touch wins: a later link does not overwrite an unclaimed ref.
  const prev = rememberedAffiliateRef()
  if (prev && prev.code !== c) return
  store()?.setItem(REF_KEY, JSON.stringify({ code: c, role: role === 'driver' ? 'driver' : 'rider', at: Date.now() }))
}

export function setAffiliateRefRole(role) {
  const prev = rememberedAffiliateRef()
  if (prev) store()?.setItem(REF_KEY, JSON.stringify({ ...prev, role: role === 'driver' ? 'driver' : 'rider' }))
}

export function rememberedAffiliateRef() {
  try {
    const v = JSON.parse(store()?.getItem(REF_KEY) || 'null')
    // Refs expire after 30 days.
    return v?.code && Date.now() - (v.at || 0) < 30 * 86400000 ? v : null
  } catch { return null }
}

export function clearAffiliateRef() {
  store()?.removeItem(REF_KEY)
}

const call = (path, opts) => authedJson(supabase, path, opts)

export const recordAffiliateClick = (code) => fetch(`${API}?action=click`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code, device_id: deviceId(), landing: typeof window !== 'undefined' ? window.location.pathname : '' }),
}).then((r) => r.json().catch(() => ({})))

export const lookupAffiliate = (code) => fetch(`${API}?action=lookup&code=${encodeURIComponent(code)}`).then((r) => (r.ok ? r.json() : null))
export const applyAffiliate = (body) => call(`${API}?action=apply`, { method: 'POST', body })
export const loadAffiliateMe = () => call(`${API}?action=me`)
export const claimAffiliate = (code, role) => call(`${API}?action=claim`, { method: 'POST', body: { code, role, device_id: deviceId() } })
export const affiliateAdmin = (action, body) => (body
  ? call(`${API}?action=admin-${action}`, { method: 'POST', body })
  : call(`${API}?action=admin-${action}`))

/** After sign-in/sign-up, attach the remembered ref once. Never blocks the app. */
export async function claimRememberedAffiliate(roleHint) {
  const ref = rememberedAffiliateRef()
  if (!ref) return null
  const role = roleHint || ref.role
  try {
    const out = await claimAffiliate(ref.code, role)
    clearAffiliateRef()
    return out
  } catch (err) {
    if (err?.status && err.status !== 401 && err.status < 500) clearAffiliateRef()
    return null
  }
}

export function formatCents(cents) {
  return `$${((Number(cents) || 0) / 100).toFixed(2)}`
}
