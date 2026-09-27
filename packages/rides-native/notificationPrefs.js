/**
 * Account notification prefs for the rider app.
 * Writes profiles.notification_prefs and mirrors the same JSON on device storage.
 */

export const NOTIFICATION_CATEGORIES = [
  { id: 'ride', label: 'Ride updates', hint: 'Requested, accepted, en route, arrived, trip started or completed' },
  { id: 'billing', label: 'Billing & receipts', hint: 'Fare charged, payment failed, receipts' },
  { id: 'friends', label: 'Friends / carpool', hint: 'Friend joined or left, carpool booked, location shared' },
  { id: 'promotions', label: 'Promotions', hint: 'Deals, surge alerts, campus campaigns' },
  { id: 'system', label: 'System', hint: 'Account, verification, security notices' },
]

export const DEFAULT_QUIET = {
  dnd: false,
  scheduleEnabled: false,
  start: '22:00',
  end: '07:00',
}

export const DEFAULT_NOTIFICATION_PREFS = {
  ride: true,
  billing: true,
  friends: true,
  promotions: false,
  system: true,
  quiet: { ...DEFAULT_QUIET },
  dndNewRequestTones: false,
}

const LS_KEY = (userId) => `clemson.notification_prefs.${userId || 'anon'}`

function hhmm(value, fallback) {
  const match = /^(\d{2}):(\d{2})$/.exec(typeof value === 'string' ? value : '')
  if (!match) return fallback
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return fallback
  return value
}

export function quietFromPrefs(raw) {
  const q = raw?.quiet && typeof raw.quiet === 'object' ? raw.quiet : {}
  return {
    dnd: Boolean(q.dnd),
    scheduleEnabled: Boolean(q.scheduleEnabled),
    start: hhmm(q.start, DEFAULT_QUIET.start),
    end: hhmm(q.end, DEFAULT_QUIET.end),
  }
}

export function normalizePrefs(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_NOTIFICATION_PREFS, quiet: { ...DEFAULT_QUIET } }
  }
  return {
    ...raw,
    ride: raw.ride !== false && raw.ride_updates !== false,
    billing: raw.billing !== false,
    friends: raw.friends !== false && raw.friends_carpool !== false,
    promotions: Boolean(raw.promotions),
    system: raw.system !== false,
    quiet: quietFromPrefs(raw),
    dndNewRequestTones: Boolean(raw.dndNewRequestTones),
  }
}

export async function readLocalPrefs(storage, userId) {
  if (!storage) return normalizePrefs(null)
  try {
    const raw = await storage.getItem(LS_KEY(userId))
    if (!raw) return normalizePrefs(null)
    return normalizePrefs(JSON.parse(raw))
  } catch {
    return normalizePrefs(null)
  }
}

export async function writeLocalPrefs(storage, userId, prefs) {
  if (!storage) return
  try {
    await storage.setItem(LS_KEY(userId), JSON.stringify(prefs))
  } catch {
    /* device storage is a mirror; the profile row is the shared copy */
  }
}

export async function fetchNotificationPrefs(supabase, storage, userId) {
  const local = await readLocalPrefs(storage, userId)
  if (!supabase || !userId) return { prefs: local, persisted: false, softFail: null }
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('notification_prefs')
      .eq('id', userId)
      .maybeSingle()
    if (error) return { prefs: local, persisted: false, softFail: error.message || 'fetch failed' }
    if (data?.notification_prefs && typeof data.notification_prefs === 'object') {
      const prefs = normalizePrefs(data.notification_prefs)
      await writeLocalPrefs(storage, userId, prefs)
      return { prefs, persisted: true, softFail: null }
    }
    return { prefs: local, persisted: false, softFail: null }
  } catch (err) {
    return { prefs: local, persisted: false, softFail: err?.message || 'fetch failed' }
  }
}

export async function saveNotificationPrefs(supabase, storage, userId, next) {
  const prefs = normalizePrefs(next)
  await writeLocalPrefs(storage, userId, prefs)
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
      return { ok: true, persisted: false, softFail: error.message || 'notification_prefs write failed', prefs }
    }
    return { ok: true, persisted: true, softFail: null, prefs }
  } catch (err) {
    return { ok: true, persisted: false, softFail: err?.message || 'write failed', prefs }
  }
}
