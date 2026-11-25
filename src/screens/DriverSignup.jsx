import { useEffect } from 'react'
import { useAuth } from '../lib/auth'
import { navigate } from '../lib/navigation'
import { DriveWithUs } from './DriveWithUs'

export const NEEDS_VEHICLE_KEY = 'clemsonrides.driver.needs_vehicle'

/** Public driver recruitment and application entry (#/driver-signup).
 *  Signed-out visitors see the recruitment overview, verified 80% fare / 100% tips
 *  terms, flexible alongside-Uber-and-Lyft positioning, and QR code before signing in.
 *  Signed-in applicants jump straight into the full step-by-step onboarding flow.
 *  needs_vehicle=1 marks an applicant who wants to be matched with a rental. */
export function DriverSignup({ needsVehicle = false } = {}) {
  const { session, loading } = useAuth()

  useEffect(() => {
    if (needsVehicle) {
      try { window.localStorage.setItem(NEEDS_VEHICLE_KEY, '1') } catch { /* storage unavailable */ }
    }
    if (loading || !session) return
    if (needsVehicle) {
      navigate('driver-onboarding', { needs_vehicle: '1' })
      return
    }
    navigate('driver-onboarding')
  }, [needsVehicle, loading, session])

  if (!loading && !session) {
    return <DriveWithUs />
  }

  return (
    <div style={{ padding: 40, color: 'var(--ink-secondary)' }}>
      Opening driver application…
    </div>
  )
}
