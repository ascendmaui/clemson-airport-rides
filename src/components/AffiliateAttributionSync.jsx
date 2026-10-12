import { useEffect } from 'react'
import { useAuth } from '../lib/auth'
import { claimRememberedAffiliate, rememberedAffiliateRef } from '../lib/affiliates'

/** Attach a remembered /r/CODE partner ref after sign-in. Driver role on driver signup paths. */
export function AffiliateAttributionSync({ path }) {
  const { user } = useAuth()
  useEffect(() => {
    if (!user?.id || !rememberedAffiliateRef()) return
    const driverPath = path === 'driver-signup' || path === 'driver-onboarding'
    claimRememberedAffiliate(driverPath ? 'driver' : undefined)
  }, [user?.id, path])
  return null
}
