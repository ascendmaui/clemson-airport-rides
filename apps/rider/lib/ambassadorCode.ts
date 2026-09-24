import { secureStoreAdapter } from 'rides-native/secureStore'
import {
  AMBASSADOR_STORAGE_KEY,
  attributionForUser,
  normalizeAmbassadorCode,
  packAttribution,
} from 'rides-native/shared/ambassadorAttribution.js'

export async function saveAmbassadorCode(code: string, userId?: string | null) {
  const packed = packAttribution(code, userId || null)
  if (!packed) {
    await secureStoreAdapter.removeItem(AMBASSADOR_STORAGE_KEY)
    return ''
  }
  await secureStoreAdapter.setItem(AMBASSADOR_STORAGE_KEY, packed)
  return normalizeAmbassadorCode(code)
}

export async function loadAmbassadorCode(userId?: string | null) {
  const raw = await secureStoreAdapter.getItem(AMBASSADOR_STORAGE_KEY)
  return attributionForUser(raw, userId || null)?.code || ''
}

export async function clearAmbassadorCode() {
  await secureStoreAdapter.removeItem(AMBASSADOR_STORAGE_KEY)
}
