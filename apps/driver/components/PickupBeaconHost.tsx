import { usePathname, useRouter } from 'expo-router'
import { PickupBeaconScreen } from 'rides-native/PickupBeacon.jsx'
import { alreadyOnLiveRide, pickupBeaconLiveRide } from '../../../shared/pickupBeacon.js'
import { useAuth } from '@/lib/auth'
import { useDriverPickupBeacon } from '@/lib/usePickupBeacon'

/** Full-screen pickup code. The X turns the locator off for this trip. */
export function PickupBeaconHost() {
  const { user } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const beacon = useDriverPickupBeacon(user?.id || null)
  if (!beacon.show || !beacon.code || !beacon.tripId) return null
  return (
    <PickupBeaconScreen
      role="driver"
      code={beacon.code}
      onClose={() => {
        const tripId = beacon.tripId
        beacon.dismiss()
        if (!tripId || alreadyOnLiveRide('driver', pathname)) return
        const next = pickupBeaconLiveRide('driver', tripId)
        router.push(next)
      }}
    />
  )
}
