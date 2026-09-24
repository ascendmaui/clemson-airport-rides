import { Linking } from 'react-native'
import { navigationLinks } from 'rides-native/mapsLink'

export async function openNavigation(
  provider: 'apple' | 'google',
  stop: { latitude: number | null; longitude: number | null; label: string },
) {
  const links = navigationLinks({
    latitude: stop.latitude,
    longitude: stop.longitude,
    label: stop.label,
  })
  const primary = provider === 'apple' ? links.apple : links.google
  try {
    await Linking.openURL(primary)
  } catch (err) {
    if (provider === 'apple') {
      await Linking.openURL(links.google)
      return
    }
    throw err instanceof Error ? err : new Error('Could not open maps')
  }
}
