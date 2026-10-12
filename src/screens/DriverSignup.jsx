import { useEffect } from 'react'
import { navigate } from '../lib/navigation'

export const NEEDS_VEHICLE_KEY = 'clemsonrides.driver.needs_vehicle'

/** Legacy route. The full application (info, documents, review) lives on driver onboarding.
 *  needs_vehicle=1 marks an applicant who wants to be matched with a rental. */
export function DriverSignup({ needsVehicle = false } = {}) {
  useEffect(() => {
    if (needsVehicle) {
      try { window.localStorage.setItem(NEEDS_VEHICLE_KEY, '1') } catch { /* storage unavailable */ }
      navigate('driver-onboarding', { needs_vehicle: '1' })
      return
    }
    navigate('driver-onboarding')
  }, [needsVehicle])
  return (
    <div style={{ padding: 40, color: 'var(--ink-secondary)' }}>
      Opening driver application…
    </div>
  )
}
