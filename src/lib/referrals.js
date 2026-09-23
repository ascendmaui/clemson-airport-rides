/**
 * Client referral helpers. Credit amounts and name privacy live in server/referralCredits.js.
 */
import { supabase } from './supabase'
import {
  isValidReferralCode,
  normalizeReferralCode,
  referralPath,
} from '../../server/referralCredits.js'

export {
  REFERRAL_REFEREE_CENTS,
  REFERRAL_REFERRER_CENTS,
  firstNameOnly,
  formatCreditCents,
  isValidReferralCode,
  normalizeReferralCode,
  referralPath,
} from '../../server/referralCredits.js'

const STORAGE_KEY = 'clemson_referral_code'

export function referralCodeFromLocation() {
  if (typeof window === 'undefined') return ''
  const pathMatch = window.location.pathname.match(/^\/r\/([^/?#]+)/i)
  if (pathMatch) return decodeURIComponent(pathMatch[1])
  const search = new URLSearchParams(window.location.search).get('ref')
  if (search) return search
  const hash = window.location.hash || ''
  const hashQuery = hash.split('?')[1] || ''
  const fromHash = new URLSearchParams(hashQuery).get('ref')
  if (fromHash) return fromHash
  const hashPath = hash.match(/^#\/r\/([^/?#]+)/i)
  if (hashPath) return decodeURIComponent(hashPath[1])
  return ''
}

export function peekStoredReferralCode() {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

export function storeReferralCode(code) {
  const normalized = normalizeReferralCode(code)
  if (!isValidReferralCode(normalized) || typeof window === 'undefined') return ''
  try {
    window.localStorage.setItem(STORAGE_KEY, normalized)
  } catch {
    /* ignore */
  }
  return normalized
}

export function clearStoredReferral() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export function captureReferralFromLocation() {
  const fromUrl = normalizeReferralCode(referralCodeFromLocation())
  if (isValidReferralCode(fromUrl)) return storeReferralCode(fromUrl)
  const stored = normalizeReferralCode(peekStoredReferralCode())
  return isValidReferralCode(stored) ? stored : ''
}

export function referralShareUrl(code) {
  const origin = typeof window !== 'undefined'
    ? window.location.origin
    : 'https://clemson-airport-rides.vercel.app'
  return `${origin}${referralPath(code)}`
}

async function authHeaders() {
  const headers = { 'Content-Type': 'application/json' }
  if (!supabase) return headers
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = await authHeaders()
  let res
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    const err = new Error(e?.message || 'Network error')
    err.status = 0
    throw err
  }
  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return data
}

export function fetchReferralSummary() {
  return api('/api/referral')
}

export function applyReferralCode(code) {
  return api('/api/referral-apply', { method: 'POST', body: { code } })
}

export function previewReferralCode(code) {
  const normalized = normalizeReferralCode(code)
  return fetch(`/api/referral-preview?code=${encodeURIComponent(normalized)}`)
    .then(async (res) => {
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        const err = new Error(data?.error || 'Preview failed')
        err.status = res.status
        throw err
      }
      return data
    })
}

/** Backup credit grant hook. Safe to call more than once for the same trip. */
export function qualifyReferralForTrip(tripId) {
  if (!tripId) return Promise.resolve(null)
  return api('/api/referral-qualify', { method: 'POST', body: { tripId } })
}

export async function applyStoredReferral() {
  const code = captureReferralFromLocation()
  if (!code) return { skipped: true }
  try {
    const data = await applyReferralCode(code)
    clearStoredReferral()
    return data
  } catch (err) {
    const status = err?.status
    if (status && status !== 401 && status !== 503 && status < 500) {
      clearStoredReferral()
    }
    throw err
  }
}

export async function copyText(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const el = document.createElement('textarea')
  el.value = text
  el.setAttribute('readonly', '')
  el.style.position = 'fixed'
  el.style.left = '-9999px'
  document.body.appendChild(el)
  el.select()
  document.execCommand('copy')
  el.remove()
}

export function referralStatusLabel(row) {
  if (row?.status === 'rewarded') {
    return row.qualifyRole === 'driver' ? 'Credited · first drive' : 'Credited · first ride'
  }
  if (row?.status === 'void') return 'Welcome credit already used'
  return 'Waiting for first trip'
}
