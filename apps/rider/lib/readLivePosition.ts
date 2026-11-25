import * as Location from 'expo-location'
import { logCaught } from '@/lib/caught'

export async function readLivePosition(): Promise<{ lat: number; lng: number } | null> {
  try {
    const current = await Location.getForegroundPermissionsAsync()
    const granted = current.granted || (await Location.requestForegroundPermissionsAsync()).granted
    if (!granted) return null
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
    const lat = pos.coords.latitude
    const lng = pos.coords.longitude
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return { lat, lng }
  } catch (err) {
    logCaught('live-position', err)
    return null
  }
}
