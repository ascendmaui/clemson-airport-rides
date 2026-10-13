import { Platform } from 'react-native'
import { isPlatformPaySupported } from '@stripe/stripe-react-native'

/** True when this iPhone can pay with Apple Pay. Android and web stay false. */
export async function applePaySetUp() {
  if (Platform.OS !== 'ios') return false
  try {
    return await isPlatformPaySupported()
  } catch {
    return false
  }
}
