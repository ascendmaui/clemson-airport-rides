import { Alert } from 'react-native'
import * as Location from 'expo-location'
import { captureCurrentLocationPickup } from 'rides-native/currentLocation.js'

function askCurrentLocationPermission() {
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      'Allow current location?',
      'Use your current location as the pickup? GPS runs only after you allow it.',
      [
        { text: "Don't allow", style: 'cancel', onPress: () => resolve(false) },
        { text: 'Allow', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    )
  })
}

async function readFreshFix() {
  const permission = await Location.requestForegroundPermissionsAsync()
  if (permission.status !== 'granted') {
    const denied = new Error('Location permission was not granted')
    ;(denied as Error & { reason?: string }).reason = 'denied'
    throw denied
  }
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
  return { lat: position.coords.latitude, lng: position.coords.longitude }
}

export function readCurrentLocationPickup() {
  return captureCurrentLocationPickup(askCurrentLocationPermission, readFreshFix)
}

export function currentLocationDeniedCopy(reason: 'denied' | 'unavailable') {
  if (reason === 'denied') {
    return 'Location was not allowed. Pick a campus or airport stop for pickup.'
  }
  return 'A fresh GPS fix was not available. Pick a campus or airport stop for pickup.'
}
