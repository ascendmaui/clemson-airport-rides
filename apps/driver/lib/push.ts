import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clemsonMiamiDriverNotification } from '../../../packages/rides-native/clemsonMiamiPromo.js'
import { formatEasternWhen } from '../../../shared/nearTermSlots.js'

let appActive = true
let driverOnline = false

/** In-app sound and vibration replace the system toast while the driver is online and the app is open. */
export function setRideAlertSurface(patch: { active?: boolean; online?: boolean }) {
  if (patch.active != null) appActive = patch.active
  if (patch.online != null) driverOnline = patch.online
}

export function inAppRideAlert() {
  return appActive && driverOnline
}

Notifications.setNotificationHandler({
  handleNotification: async () => {
    const inApp = inAppRideAlert()
    return {
      shouldShowBanner: !inApp,
      shouldShowList: true,
      shouldPlaySound: !inApp,
      shouldSetBadge: false,
    }
  },
})

export const RIDE_CHANNEL_ID = 'ride-requests'

/** Must match DRIVER_STATUS_PUSH_FEATURE in server/tripStatusNotices.js. */
export const TRIP_STATUS_PUSH_FEATURE = 'trip_status_v1'
/** Server status pushes; these are not ride offers, so the offer banner ignores them. */
export const TRIP_STATUS_PUSH_KINDS = ['arrive_prompt', 'rider_canceled', 'rider_ended_early', 'rider_no_show']

export function isTripStatusPush(data: unknown): boolean {
  const kind = data && typeof data === 'object' ? (data as { kind?: unknown }).kind : null
  return typeof kind === 'string' && TRIP_STATUS_PUSH_KINDS.includes(kind)
}

/** Android 8+ plays a custom sound only when that sound is set on a channel. */
export function rideChannelRequest() {
  return {
    name: 'Ride requests',
    importance: 4,
    sound: 'request.wav',
    vibrationPattern: [0, 250, 120, 250],
    lockscreenVisibility: 1,
  }
}

export async function ensureRideChannel() {
  if (Platform.OS !== 'android') return false
  const create = Notifications.setNotificationChannelAsync
  if (typeof create !== 'function') return false
  try {
    await create(RIDE_CHANNEL_ID, rideChannelRequest())
    return true
  } catch {
    return false
  }
}

function androidChannelFields(): { channelId?: string } {
  if (Platform.OS !== 'android') return {}
  return { channelId: RIDE_CHANNEL_ID }
}

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
    await ensureRideChannel()
    const asked = await Notifications.requestPermissionsAsync()
    status = asked.status
  }
  await ensureRideChannel()
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
  const row = { driver_id: driverId, token, platform: Platform.OS, updated_at: updatedAt }
  // features tells the server this build handles trip status pushes (Arrived?, rider canceled).
  const table = await supabase.from('driver_push_tokens').upsert({ ...row, features: [TRIP_STATUS_PUSH_FEATURE] })
  if (!table.error) return true
  if (!/features|schema cache/i.test(table.error.message || '')) return false
  const plain = await supabase.from('driver_push_tokens').upsert(row)
  return !plain.error
}

export async function notifyAcceptedRide(card: {
  id: string
  pickupLabel: string
  dropoffLabel: string
}) {
  await ensureRideChannel()
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Ride accepted',
      body: `${card.pickupLabel} → ${card.dropoffLabel}`,
      data: { tripId: card.id },
      sound: 'request.wav',
      ...androidChannelFields(),
    },
    trigger: null,
  })
}

export async function notifyScheduledBoard(card: {
  id: string
  pickupLabel: string
  dropoffLabel: string
  pickupAt?: string | null
}) {
  const whenLabel = card.pickupAt ? formatEasternWhen(card.pickupAt) : null
  const when = whenLabel ? ` · ${whenLabel}` : ''
  await ensureRideChannel()
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Scheduled ride on the board',
      body: `${card.pickupLabel} → ${card.dropoffLabel}${when}`,
      data: { tripId: card.id, kind: 'scheduled_board' },
      sound: 'request.wav',
      ...androidChannelFields(),
    },
    trigger: null,
  })
}

export async function notifyNewRequest(card: {
  id: string
  pickupLabel: string
  dropoffLabel: string
  tagLabels?: string[]
  promoRide?: boolean
  now?: string | number | Date
}) {
  const flags = (card.tagLabels || []).slice(0, 3).join(' · ')
  const routeBody = flags
    ? `${card.pickupLabel} → ${card.dropoffLabel} · ${flags}`
    : `${card.pickupLabel} → ${card.dropoffLabel}`
  const promo = card.promoRide
    ? clemsonMiamiDriverNotification(card.now ? new Date(card.now) : new Date())
    : null
  await ensureRideChannel()
  await Notifications.scheduleNotificationAsync({
    content: {
      title: promo?.title || 'New ride request',
      body: promo?.body || routeBody,
      data: { tripId: card.id },
      sound: 'request.wav',
      ...androidChannelFields(),
    },
    trigger: null,
  })
}
