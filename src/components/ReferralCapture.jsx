import { useEffect } from 'react'
import { useAuth } from '../lib/auth'
import { applyStoredReferral, captureReferralFromLocation } from '../lib/referrals'
import { pushToast } from '../lib/toasts'

/** Persists ?ref= /r/:code and attaches it once a session exists. */
export function ReferralCapture() {
  const { user, configured } = useAuth()

  useEffect(() => {
    captureReferralFromLocation()
  }, [])

  useEffect(() => {
    if (!configured || !user?.id) return undefined
    let alive = true
    applyStoredReferral()
      .then((res) => {
        if (!alive || !res?.applied) return
        pushToast({
          kind: 'system',
          category: 'system',
          title: 'Referral saved',
          body: `You’re connected with ${res.referrerFirstName || 'your friend'}. Credit lands after your first trip.`,
        })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [configured, user?.id])

  return null
}
