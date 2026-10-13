/** One in-app toast per Friday coupon, for a signed-in session. */

export const WEEKLY_COUPON_SEEN_KEY = 'clemson.weekly_coupon_seen'

export function readSeenCouponId(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(WEEKLY_COUPON_SEEN_KEY) || ''
  } catch {
    return ''
  }
}

export function rememberSeenCouponId(couponId, storage = globalThis.localStorage) {
  try {
    storage?.setItem(WEEKLY_COUPON_SEEN_KEY, String(couponId || ''))
  } catch {
    /* private mode */
  }
}

/**
 * Promotions default to off in notification prefs. The Friday drop is a
 * product notice, so a missing or default prefs object still notifies.
 * An explicit promotions: false opt-out suppresses the toast.
 */
export function weeklyDropAllowed(prefs) {
  if (!prefs || typeof prefs !== 'object') return true
  if (!Object.prototype.hasOwnProperty.call(prefs, 'promotions')) return true
  return prefs.promotions !== false
}

/** Raw saved prefs only. The in-memory default (promotions off) is not an opt-out. */
export function readExplicitNotificationPrefs(userId, storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(`clemson.notification_prefs.${userId || 'anon'}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export function weeklyDropToast({ coupon, seenId = '', signedIn = false, prefs = null } = {}) {
  if (!signedIn || !coupon?.id || !coupon?.code) return null
  if (!weeklyDropAllowed(prefs)) return null
  if (seenId === coupon.id) return null
  return {
    id: `weekly-coupon-${coupon.id}`,
    kind: 'promo_weekly',
    category: 'promotions',
    force: true,
    title: `This week’s coupon · ${coupon.title}`,
    body: `${coupon.code} — ${coupon.detail}`,
    durationMs: 8000,
  }
}
