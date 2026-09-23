/**
 * Account → Notifications prefs.
 * Persist to profiles.notification_prefs jsonb when available;
 * always mirror to localStorage. Soft-fail writes if column missing.
 */
import { supabase } from './supabase'
import { DEFAULT_QUIET } from './quietHours.js'

export { DEFAULT_QUIET, isQuietNow, quietFromPrefs } from './quietHours.js'

export const NOTIFICATION_CATEGORIES = [
  { id: 'ride', label: 'Ride updates', hint: 'Requested, accepted, en route, arrived, trip started/completed' },
  { id: 'billing', label: 'Billing & receipts', hint: 'Fare charged, payment failed, receipts' },
  { id: 'friends', label: 'Friends / carpool', hint: 'Friend joined/left, carpool booked, location shared' },
  { id: 'promotions', label: 'Promotions', hint: 'Deals, surge alerts, campus campaigns' },
  { id: 'system', label: 'System', hint: 'Account, verification, security notices' },
]

export const DEFAULT_NOTIFICATION_PREFS = {
  ride: true,
  billing: true,
  friends: true,
  promotions: false,
  system: true,
  quiet: { ...DEFAULT_QUIET },
  /** Mutes the tone for new ride requests only. Mid-ride cancel tones ignore this. */
  dndNewRequestTones: false,
}

const LS_KEY = (userId) => `clemson.notification_prefs.${userId || 'anon'}`

export function loadLocalPrefs(userId) {
  try {
    const raw = localStorage.getItem(LS_KEY(userId))
    if (!raw) return { ...DEFAULT_NOTIFICATION_PREFS }
    return { ...DEFAULT_NOTIFICATION_PREFS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFS }
  }
}

export function saveLocalPrefs(userId, prefs) {
  try {
    localStorage.setItem(LS_KEY(userId), JSON.stringify(prefs))
  } catch {
    /* ignore */
  }
}

export function normalizePrefs(raw) {
  const base = raw && typeof raw === 'object' ? { ...raw } : {}
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_NOTIFICATION_PREFS, quiet: { ...DEFAULT_QUIET } }
  return {
    ...base,
    ride: raw.ride !== false && raw.ride_updates !== false,
    billing: raw.billing !== false,
    friends: raw.friends !== false && raw.friends_carpool !== false,
    promotions: Boolean(raw.promotions),
    system: raw.system !== false,
    quiet: quietFromPrefs(raw),
    dndNewRequestTones: Boolean(raw.dndNewRequestTones),
  }
}

/**
 * @returns {{ prefs: object, persisted: boolean, softFail: string|null }}
 */
export async function fetchNotificationPrefs(userId) {
  const local = loadLocalPrefs(userId)
  if (!supabase || !userId) return { prefs: local, persisted: false, softFail: null }
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('notification_prefs')
      .eq('id', userId)
      .maybeSingle()
    if (error) {
      // Column missing or RLS — keep local
      if (/notification_prefs|column|schema cache/i.test(error.message || '')) {
        return { prefs: local, persisted: false, softFail: error.message }
      }
      return { prefs: local, persisted: false, softFail: error.message }
    }
    if (data?.notification_prefs && typeof data.notification_prefs === 'object') {
      const prefs = normalizePrefs(data.notification_prefs)
      saveLocalPrefs(userId, prefs)
      return { prefs, persisted: true, softFail: null }
    }
    return { prefs: local, persisted: false, softFail: null }
  } catch (e) {
    return { prefs: local, persisted: false, softFail: e.message || 'fetch failed' }
  }
}

/**
 * Best-effort write to profiles.notification_prefs; always updates localStorage.
 * @returns {{ ok: boolean, persisted: boolean, softFail: string|null, prefs: object }}
 */
export async function saveNotificationPrefs(userId, next) {
  const prefs = normalizePrefs(next)
  saveLocalPrefs(userId, prefs)
  if (!supabase || !userId) return { ok: true, persisted: false, softFail: null, prefs }
  try {
    const { error } = await supabase
      .from('profiles')
      .update({
        notification_prefs: prefs,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)
    if (error) {
      return {
        ok: true,
        persisted: false,
        softFail: error.message || 'profiles.notification_prefs write failed',
        prefs,
      }
    }
    return { ok: true, persisted: true, softFail: null, prefs }
  } catch (e) {
    return {
      ok: true,
      persisted: false,
      softFail: e.message || 'write failed',
      prefs,
    }
  }
}

/** Category for a toast kind — used to gate pushToast */
export function categoryForToastKind(kind) {
  const k = String(kind || '')
  if (k === 'canceled_midride') return 'ride'
  if (/^ride_|^trip_|^driver_|^arrived|^en_route/.test(k)) return 'ride'
  if (/^pay|^fare|^billing|^receipt/.test(k)) return 'billing'
  if (/^friend|^carpool|^location_shared/.test(k)) return 'friends'
  if (k === 'driver_incentive' || k === 'incentive_started') return 'system'
  if (/^promo|^surge|^busy/.test(k)) return 'promotions'
  return 'system'
}
