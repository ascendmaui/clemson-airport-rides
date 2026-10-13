import { Linking } from 'react-native'
import { autoNavigationKey, readLaunchedLegs, withLaunchedLeg } from 'rides-native/autoNavigation'
import { navAppOrder, navigationUrl, type NavApp } from 'rides-native/mapsLink'
import { authStorage } from '@/lib/storage'

type Stop = { latitude: number | null; longitude: number | null; label: string }

/**
 * Opens directions in the chosen app. If that app cannot open, tries the
 * remaining apps in a stable order (Waze → Apple → Google, and so on).
 * A null provider means no preference is saved, so Apple opens first and the
 * other apps follow — the same chooser the trip screen shows.
 */
export async function openNavigation(provider: NavApp | null | undefined, stop: Stop) {
  let last: unknown = null
  for (const app of navAppOrder(provider)) {
    try {
      await Linking.openURL(navigationUrl(app, stop))
      return app
    } catch (err) {
      last = err
    }
  }
  throw last instanceof Error ? last : new Error('Could not open maps')
}

/**
 * Mark the pickup leg, then open directions. Marking first keeps the trip
 * screen from opening the same pickup a second time.
 */
export async function openAcceptedPickup(tripId: string, provider: NavApp | null | undefined, stop: Stop) {
  const key = autoNavigationKey(tripId)
  const launched = readLaunchedLegs(await authStorage.getItem(key))
  if (!launched.includes('pickup')) {
    await authStorage.setItem(key, JSON.stringify(withLaunchedLeg(launched, 'pickup')))
  }
  await openNavigation(provider, stop)
}
