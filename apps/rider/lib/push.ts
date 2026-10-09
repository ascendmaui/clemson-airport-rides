import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Must match RIDER_PUSH_CHANNEL in server/tripStatusNotices.js. */
export const TRIP_STATUS_CHANNEL_ID = 'trip-status'

Notifications.setNotificationHandler({
  // The live trip screen already shows the change, so foreground pushes stay quiet.
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
})

export type RiderPushState = { granted: boolean; stored: boolean; token: string | null; detail: string | null }

async function ensureChannel() {
  if (Platform.OS !== 'android' || typeof Notifications.setNotificationChannelAsync !== 'function') return
  try {
    await Notifications.setNotificationChannelAsync(TRIP_STATUS_CHANNEL_ID, {
      name: 'Ride updates',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 100, 200],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    })
  } catch { /* channel creation is best-effort */ }
}

/**
 * Registers this phone for ride-status pushes (driver on the way, 1 min away, here).
 * prompt=false only refreshes the token when permission was already granted.
 */
export async function registerRiderPush(
  supabase: SupabaseClient | null,
  riderId: string | null | undefined,
  { prompt = false }: { prompt?: boolean } = {},
): Promise<RiderPushState> {
  if (!supabase || !riderId || Platform.OS === 'web') return { granted: false, stored: false, token: null, detail: null }
  await ensureChannel()
  let { status } = await Notifications.getPermissionsAsync()
  if (status !== 'granted' && prompt) status = (await Notifications.requestPermissionsAsync()).status
  if (status !== 'granted') {
    return { granted: false, stored: false, token: null, detail: 'Notifications are off. Ride updates still show while the app is open.' }
  }
  const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId
  let token: string | null = null
  try {
    token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data
  } catch (err) {
    return { granted: true, stored: false, token: null, detail: err instanceof Error ? err.message : 'Push token is unavailable on this device.' }
  }
  const saved = await supabase.from('rider_push_tokens').upsert({
    rider_id: riderId,
    token,
    platform: Platform.OS,
    updated_at: new Date().toISOString(),
  })
  return { granted: true, stored: !saved.error, token, detail: saved.error ? 'Could not save this phone for ride updates.' : null }
}

/** Trip id carried by a ride-status push, or null for anything else. */
export function tripIdFromPush(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const tripId = (data as { tripId?: unknown }).tripId
  return typeof tripId === 'string' && tripId ? tripId : null
}
