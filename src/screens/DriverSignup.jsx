import { useEffect } from 'react'
import { navigate } from '../lib/navigation'

/** Legacy route. The full application (info, documents, review) lives on driver onboarding. */
export function DriverSignup() {
  useEffect(() => {
    navigate('driver-onboarding')
  }, [])
  return (
    <div style={{ padding: 40, color: 'var(--ink-secondary)' }}>
      Opening driver application…
    </div>
  )
}
