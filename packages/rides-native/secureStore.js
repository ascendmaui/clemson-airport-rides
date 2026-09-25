import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { createChunkedStore } from './secureChunks.js'

const memory = new Map()
const native = Platform.OS === 'ios' || Platform.OS === 'android'

// deleteItemAsync rejects for an invalid key and for a failed commit. A missing
// item is success: the test double says "Could not find key ...", and an older
// keychain build says the item could not be found.
function isAlreadyGone(error) {
  const message = typeof error?.message === 'string' ? error.message : String(error ?? '')
  return /could not find key|could not be found in the keychain|errSecItemNotFound/i.test(message)
}

const backend = native
  ? {
      getItem: (key) => SecureStore.getItemAsync(key),
      setItem: (key, value) => SecureStore.setItemAsync(key, value, {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
      }),
      removeItem: async (key) => {
        try {
          await SecureStore.deleteItemAsync(key)
        } catch (error) {
          if (!isAlreadyGone(error)) throw error
        }
      },
    }
  : {
      async getItem(key) {
        return memory.has(key) ? memory.get(key) : null
      },
      async setItem(key, value) {
        memory.set(key, value)
      },
      async removeItem(key) {
        memory.delete(key)
      },
    }

/** Session and signup-cooldown storage. Native uses the keychain via expo-secure-store. */
export const secureStoreAdapter = createChunkedStore(backend)
