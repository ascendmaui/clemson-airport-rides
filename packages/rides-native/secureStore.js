import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { createChunkedStore } from './secureChunks.js'

const memory = new Map()
const native = Platform.OS === 'ios' || Platform.OS === 'android'

const backend = native
  ? {
      getItem: (key) => SecureStore.getItemAsync(key),
      setItem: (key, value) => SecureStore.setItemAsync(key, value, {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
      }),
      removeItem: async (key) => {
        try {
          await SecureStore.deleteItemAsync(key)
        } catch {
          /* already gone */
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
