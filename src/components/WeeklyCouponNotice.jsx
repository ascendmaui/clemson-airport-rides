import { useEffect } from 'react'
import { useAuth } from '../lib/auth'
import { pushToast } from '../lib/toasts'
import {
  readExplicitNotificationPrefs,
  readSeenCouponId,
  rememberSeenCouponId,
  weeklyDropToast,
} from '../lib/weeklyCouponNotice'
import { currentWeeklyCoupon } from '../../shared/weeklyCoupon.js'

/** Signed-in sessions see one toast per Friday coupon id. */
export function WeeklyCouponNotice() {
  const { user } = useAuth()
  useEffect(() => {
    if (!user?.id) return undefined
    const coupon = currentWeeklyCoupon(new Date())
    const prefs = readExplicitNotificationPrefs(user.id)
    const toast = weeklyDropToast({
      coupon,
      seenId: readSeenCouponId(),
      signedIn: true,
      prefs,
    })
    if (!toast) return undefined
    pushToast(toast)
    rememberSeenCouponId(coupon.id)
    return undefined
  }, [user?.id])
  return null
}
