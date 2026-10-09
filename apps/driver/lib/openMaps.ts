import { Linking } from 'react-native'
import { navAppOrder, navigationUrl, type NavApp } from 'rides-native/mapsLink'

type Stop = { latitude: number | null; longitude: number | null; label: string }

/**
 * Opens directions in the chosen app. If that app cannot open, tries the
 * remaining apps in a stable order (Waze → Apple → Google, and so on).
 */
export async function openNavigation(provider: NavApp, stop: Stop) {
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
