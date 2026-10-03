/**
 * Signup-link capture for the $1 Clemson vs Miami ride.
 * The query is fixed. There is no code field and no client price.
 */
import { authedJson } from './apiClient.js'
import { navigate } from './navigation.js'
import { supabase } from './supabase.js'
import { CLEMSON_MIAMI_RIDE } from '../../packages/rides-native/clemsonMiamiPromo.js'

const STORAGE_KEY = 'clemson_miami_ride'
const NOTICE_KEY = 'clemson_miami_notice'

let inflight = null

export function rememberClemsonMiamiFromLocation() {
  if (typeof window === 'undefined') return false
  const hash = window.location.hash || ''
  const hashQs = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : ''
  const ride = new URLSearchParams(hashQs).get('ride')
    || new URLSearchParams(window.location.search || '').get('ride')
    || ''
  if (ride !== CLEMSON_MIAMI_RIDE) return hasClemsonMiamiLink()
  try {
    window.localStorage.setItem(STORAGE_KEY, CLEMSON_MIAMI_RIDE)
  } catch {
    /* private mode can block storage; the hash still carries the link */
  }
  return true
}

export function hasClemsonMiamiLink() {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(STORAGE_KEY) === CLEMSON_MIAMI_RIDE
  } catch {
    return false
  }
}

export function clearClemsonMiamiLink() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

function rememberNotice(message) {
  if (typeof window === 'undefined' || !message) return
  try {
    window.sessionStorage.setItem(NOTICE_KEY, message)
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event('clemson-miami-notice'))
}

export function takeClemsonMiamiNotice() {
  if (typeof window === 'undefined') return ''
  try {
    const message = window.sessionStorage.getItem(NOTICE_KEY) || ''
    if (message) window.sessionStorage.removeItem(NOTICE_KEY)
    return message
  } catch {
    return ''
  }
}

async function runCheckout() {
  if (supabase?.auth?.getSession) {
    const { data } = await supabase.auth.getSession()
    if (!data?.session) return null
  }
  const data = await authedJson(supabase, '/api/stripe-payment-methods?action=clemson-miami', {
    method: 'POST',
    body: { ride: CLEMSON_MIAMI_RIDE },
  })
  clearClemsonMiamiLink()
  if (data?.url && typeof window !== 'undefined') {
    window.location.assign(data.url)
    return data
  }
  if (data?.tripId) {
    navigate('requested', { trip: data.tripId, paid: '1' })
  }
  return data
}

/** Starts Stripe Checkout once for the rider who opened the signup link. */
export function openClemsonMiamiCheckout() {
  if (!hasClemsonMiamiLink()) return Promise.resolve(null)
  if (!inflight) {
    inflight = runCheckout()
      .catch((err) => {
        if (err?.status === 409 || err?.status === 403) clearClemsonMiamiLink()
        rememberNotice(err?.message || 'The $1 ride could not start.')
        throw err
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}
