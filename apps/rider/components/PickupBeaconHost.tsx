import { usePathname, useRouter } from 'expo-router'
import { PickupBeaconScreen } from 'rides-native/PickupBeacon.jsx'
import { alreadyOnLiveRide, pickupBeaconLiveRide } from '../../../shared/pickupBeacon.js'
import { useSosEngaged } from '@/lib/sosEngaged'
import { useAuth } from '@/lib/auth'
import { useRiderPickupBeacon } from '@/lib/usePickupBeacon'

/** Orange pickup code. The X turns the locator off for this trip. */
export function PickupBeaconHost() {
  const { user } = useAuth()
  const paused = useSosEngaged()
  const router = useRouter()
  const pathname = usePathname()
  const beacon = useRiderPickupBeacon(user?.id || null)
  if (paused || !beacon.show || !beacon.code || !beacon.tripId) return null
  return (
    <PickupBeaconScreen
      role="rider"
      code={beacon.code}
      onClose={() => {
        const tripId = beacon.tripId
        beacon.dismiss()
        if (!tripId || alreadyOnLiveRide('rider', pathname)) return
        const next = pickupBeaconLiveRide('rider', tripId)
        router.push(next)
      }}
    />
  )
}
