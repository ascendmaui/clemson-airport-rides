import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import type { SupabaseClient } from '@supabase/supabase-js'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

export type PushState = {
  granted: boolean
  token: string | null
  stored: boolean
  detail: string | null
}

export async function registerDriverPush(supabase: SupabaseClient | null, driverId: string | undefined): Promise<PushState> {
  if (!driverId) {
    return { granted: false, token: null, stored: false, detail: 'Sign in to enable ride alerts.' }
  }
  const existing = await Notifications.getPermissionsAsync()
  let status = existing.status
  if (status !== 'granted') {
    const asked = await Notifications.requestPermissionsAsync()
    status = asked.status
  }
  if (status !== 'granted') {
    return {
      granted: false,
      token: null,
      stored: false,
      detail: 'Notifications are off. New requests still show in the queue while this app is open.',
    }
  }
  const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId
  let token: string | null = null
  try {
    const issued = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
    token = issued.data
  } catch (err) {
    return {
      granted: true,
      token: null,
      stored: false,
      detail: err instanceof Error ? err.message : 'Push token is unavailable on this device.',
    }
  }
  const stored = await storeToken(supabase, driverId, token)
  return {
    granted: true,
    token,
    stored,
    detail: stored
      ? 'This phone is registered for new ride requests.'
      : 'In-app alerts are on. Saving the push token failed, so a closed app may miss the ping.',
  }
}

async function storeToken(supabase: SupabaseClient | null, driverId: string, token: string | null) {
  if (!supabase || !token) return false
  const updatedAt = new Date().toISOString()
  const status = await supabase.from('driver_status').upsert({
    driver_id: driverId,
    expo_push_token: token,
    updated_at: updatedAt,
  })
  if (!status.error) return true
  if (!/expo_push_token|column|schema cache/i.test(status.error.message || '')) return false
  const table = await supabase.from('driver_push_tokens').upsert({
    driver_id: driverId,
    token,
    platform: Platform.OS,
    updated_at: updatedAt,
  })
  return !table.error
}

export async function notifyNewRequest(card: {
  id: string
  pickupLabel: string
  dropoffLabel: string
  tagLabels?: string[]
}) {
  const flags = (card.tagLabels || []).slice(0, 3).join(' · ')
  const body = flags
    ? `${card.pickupLabel} → ${card.dropoffLabel} · ${flags}`
    : `${card.pickupLabel} → ${card.dropoffLabel}`
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'New ride request',
      body,
      data: { tripId: card.id },
      sound: 'request.wav',
    },
    trigger: null,
  })
}
