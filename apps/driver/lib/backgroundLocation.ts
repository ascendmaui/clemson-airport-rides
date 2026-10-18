import * as Location from 'expo-location'
import * as TaskManager from 'expo-task-manager'
import { Platform } from 'react-native'
import { createTripLocationHeartbeat, isActiveTripLocationStatus, newestTripLocation, ONLINE_LOCATION_DISTANCE_M, ONLINE_LOCATION_INTERVAL_MS, shouldPublishTripLocation, TRIP_LOCATION_HEARTBEAT_MS } from 'rides-native/backgroundLocation'
import { publishDriverLocation as writeDriverLocation } from 'rides-native/driverDesk'
import { authStorage } from './storage'
import { supabase } from './supabase'

export const DRIVER_TRIP_LOCATION_TASK = 'driver-trip-location'
export const DRIVER_ONLINE_LOCATION_TASK = 'driver-online-location'
const ACTIVE_TRIP_KEY = 'driver.active-trip-location'
const ONLINE_DRIVER_KEY = 'driver.online-location'
const LAST_PUBLISH_KEY = 'driver.last-location-publish'
const native = Platform.OS === 'ios' || Platform.OS === 'android'

export type BackgroundLocationStatus = 'started' | 'foreground-denied' | 'background-denied' | 'inactive' | 'unsupported'
export type OnlineBackgroundLocationStatus = 'started' | 'background-denied' | 'unsupported'
type DriverLocationInput = Parameters<typeof writeDriverLocation>[2]

// Foreground callbacks, task deliveries, permission prompts and stops share one
// queue. A stop during a permission prompt therefore cannot leave a new service running.
let pending: Promise<unknown> = Promise.resolve()
function serial<T>(work: () => Promise<T>): Promise<T> {
  const result = pending.then(work)
  pending = result.catch(() => {})
  return result
}

async function stopUpdates(expectedTripId?: string): Promise<void> {
  if (expectedTripId && await authStorage.getItem(ACTIVE_TRIP_KEY) !== expectedTripId) return
  tripHeartbeat.stop()
  // Invalidate task uploads even if stopping the OS service fails.
  await authStorage.removeItem(ACTIVE_TRIP_KEY)
  if (native && await Location.hasStartedLocationUpdatesAsync(DRIVER_TRIP_LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(DRIVER_TRIP_LOCATION_TASK)
  }
}

async function activeTrip(tripId: string) {
  if (!supabase) return null
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) throw sessionError
  const user = sessionData.session?.user
  if (!user) return null
  const { data: trip, error } = await supabase.from('trips')
    .select('id, status').eq('id', tripId).eq('driver_id', user.id).maybeSingle()
  // A temporary network failure is not proof that the trip ended.
  if (error) throw error
  if (!trip || !isActiveTripLocationStatus(trip.status)) return null
  return { id: trip.id as string, status: trip.status as string, driverId: user.id }
}

const tripHeartbeat = createTripLocationHeartbeat({
  intervalMs: TRIP_LOCATION_HEARTBEAT_MS,
  publish: async (fix) => {
    try {
      await serial(async () => {
        const tripId = await authStorage.getItem(ACTIVE_TRIP_KEY)
        if (!tripId || !supabase) return
        const trip = await activeTrip(tripId)
        if (!trip) {
          await stopUpdates()
          return
        }
        await publish(supabase, trip.driverId, {
          lat: fix.lat,
          lng: fix.lng,
          heading: fix.heading,
          speed: fix.speed,
          tripId: trip.id,
          tripStatus: trip.status,
        })
      })
    } catch (failure) {
      console.warn('[trip location]', failure instanceof Error ? failure.message : 'Location heartbeat failed')
    }
  },
  active: async () => Boolean(await authStorage.getItem(ACTIVE_TRIP_KEY)),
})

function rememberFix(fix: { lat?: number | null; lng?: number | null; heading?: number | null; speed?: number | null } | null) {
  tripHeartbeat.remember(fix)
}

async function publish(client: unknown, driverId: string, fix: DriverLocationInput): Promise<void> {
  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return
  rememberFix(fix)
  const stored = await authStorage.getItem(LAST_PUBLISH_KEY)
  const lastPublishedAt = stored == null ? null : Number(stored)
  if (!shouldPublishTripLocation(lastPublishedAt, Date.now())) return
  await writeDriverLocation(client, driverId, fix)
  // Secure storage survives a headless JS restart, and is shared with foreground uploads.
  await authStorage.setItem(LAST_PUBLISH_KEY, String(Date.now()))
}

export type PublishGuards = { isCurrent?: () => boolean; onlineIsCurrent?: () => boolean }

/**
 * Location (and, from the presence heartbeat only, online) publisher for foreground screens.
 * Guards are re-checked inside the queue, right before the write, so a write queued before
 * END cannot mark the driver online after it.
 */
export function publishDriverLocation(client: unknown, driverId: string, fix: DriverLocationInput, guards: PublishGuards = {}): Promise<void> {
  return serial(async () => {
    if (!supabase) return
    if (guards.isCurrent && !guards.isCurrent()) return
    if (fix.online && guards.onlineIsCurrent && !guards.onlineIsCurrent()) {
      fix = { ...fix, online: undefined, onlineSource: undefined }
    }
    const { data, error } = await supabase.auth.getSession()
    if (error) throw error
    if (data.session?.user.id !== driverId) return
    if (fix.tripId) {
      const trip = await activeTrip(fix.tripId)
      if (!trip) { await stopUpdates(fix.tripId); return }
      await publish(client, driverId, { ...fix, tripStatus: trip.status })
    } else {
      await publish(client, driverId, fix)
    }
  })
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(DRIVER_TRIP_LOCATION_TASK, async ({ data, error }) => {
  if (error) { console.warn('[trip location]', error.message); return }
  try {
    await serial(async () => {
      const tripId = await authStorage.getItem(ACTIVE_TRIP_KEY)
      if (!tripId) { await stopUpdates(); return }
      const trip = await activeTrip(tripId)
      if (!trip) { await stopUpdates(); return }
      const location = newestTripLocation(data?.locations)
      if (!location) return
      rememberFix({
        lat: location.coords.latitude,
        lng: location.coords.longitude,
        heading: location.coords.heading,
        speed: location.coords.speed,
      })
      await publish(supabase, trip.driverId, {
        lat: location.coords.latitude,
        lng: location.coords.longitude,
        heading: location.coords.heading,
        speed: location.coords.speed,
        tripId: trip.id,
        tripStatus: trip.status,
      })
    })
  } catch (failure) {
    console.warn('[trip location]', failure instanceof Error ? failure.message : 'Location upload failed')
  }
})

export function startTripBackgroundLocation(tripId: string): Promise<BackgroundLocationStatus> {
  return serial<BackgroundLocationStatus>(async () => {
    if (!native) return 'unsupported'
    if (!await activeTrip(tripId)) { await stopUpdates(tripId); return 'inactive' }
    const foreground = await Location.requestForegroundPermissionsAsync()
    if (foreground.status !== 'granted') { await stopUpdates(); return 'foreground-denied' }
    const background = await Location.requestBackgroundPermissionsAsync()
    if (background.status !== 'granted') { await stopUpdates(); return 'background-denied' }
    // The rider may cancel (or the driver may sign out) while the prompt is open.
    if (!await activeTrip(tripId)) { await stopUpdates(); return 'inactive' }
    await authStorage.setItem(ACTIVE_TRIP_KEY, tripId)
    if (!await Location.hasStartedLocationUpdatesAsync(DRIVER_TRIP_LOCATION_TASK)) {
      await Location.startLocationUpdatesAsync(DRIVER_TRIP_LOCATION_TASK, {
        accuracy: Location.Accuracy.High,
        activityType: Location.ActivityType.AutomotiveNavigation,
        // timeInterval is Android. deferredUpdatesInterval is iOS.
        // distanceInterval 0 keeps a stationary car on the clock instead of waiting for 15 m.
        timeInterval: TRIP_LOCATION_HEARTBEAT_MS,
        distanceInterval: 0,
        deferredUpdatesInterval: TRIP_LOCATION_HEARTBEAT_MS,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'Clemson Rides trip in progress',
          notificationBody: 'Sharing your location with your rider until the trip ends.',
        },
      })
    }
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      rememberFix({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        heading: pos.coords.heading,
        speed: pos.coords.speed,
      })
    } catch {
      /* The background task still publishes the next fix the OS delivers. */
    }
    tripHeartbeat.start()
    return 'started'
  })
}

/** Resolves once every queued location write has finished (END waits on this). */
export function drainLocationWrites(): Promise<void> {
  return serial(async () => {})
}

export function stopTripBackgroundLocation(expectedTripId?: string): Promise<void> {
  return serial(() => stopUpdates(expectedTripId))
}

async function stopOnlineUpdates(): Promise<void> {
  // Invalidate task uploads even if stopping the OS service fails.
  await authStorage.removeItem(ONLINE_DRIVER_KEY)
  if (native && await Location.hasStartedLocationUpdatesAsync(DRIVER_ONLINE_LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(DRIVER_ONLINE_LOCATION_TASK)
  }
}

/**
 * While online with no trip, iOS suspends the JS presence heartbeat as soon as the app
 * leaves the foreground, so the driver's pin froze until they reopened the app.
 * This OS location service keeps publishing location-only writes (never online=true,
 * so it cannot undo END) until the driver goes offline, signs out, or the server says offline.
 */
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(DRIVER_ONLINE_LOCATION_TASK, async ({ data, error }) => {
  if (error) { console.warn('[online location]', error.message); return }
  try {
    await serial(async () => {
      const driverId = await authStorage.getItem(ONLINE_DRIVER_KEY)
      if (!driverId || !supabase) { await stopOnlineUpdates(); return }
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      if (sessionData.session?.user.id !== driverId) { await stopOnlineUpdates(); return }
      const status = await supabase.from('driver_status').select('online').eq('driver_id', driverId).maybeSingle()
      // A temporary read failure is not proof the driver went offline.
      if (!status.error && status.data && status.data.online === false) { await stopOnlineUpdates(); return }
      const location = newestTripLocation(data?.locations)
      if (!location) return
      await publish(supabase, driverId, {
        lat: location.coords.latitude,
        lng: location.coords.longitude,
        heading: location.coords.heading,
        speed: location.coords.speed,
      })
    })
  } catch (failure) {
    console.warn('[online location]', failure instanceof Error ? failure.message : 'Location upload failed')
  }
})

/**
 * Keep the online pin moving while the app is in the background. Never prompts: it starts
 * only when "Always" was already granted (the trip screen asks, after its disclosure).
 */
export function startOnlineBackgroundLocation(driverId: string): Promise<OnlineBackgroundLocationStatus> {
  return serial<OnlineBackgroundLocationStatus>(async () => {
    if (!native) return 'unsupported'
    const background = await Location.getBackgroundPermissionsAsync()
    if (background.status !== 'granted') { await stopOnlineUpdates(); return 'background-denied' }
    await authStorage.setItem(ONLINE_DRIVER_KEY, driverId)
    if (!await Location.hasStartedLocationUpdatesAsync(DRIVER_ONLINE_LOCATION_TASK)) {
      await Location.startLocationUpdatesAsync(DRIVER_ONLINE_LOCATION_TASK, {
        accuracy: Location.Accuracy.High,
        activityType: Location.ActivityType.AutomotiveNavigation,
        timeInterval: ONLINE_LOCATION_INTERVAL_MS,
        distanceInterval: ONLINE_LOCATION_DISTANCE_M,
        deferredUpdatesInterval: ONLINE_LOCATION_INTERVAL_MS,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'Clemson Rides: you are online',
          notificationBody: 'Sharing your location so nearby ride requests can reach you. Go offline to stop.',
        },
      })
    }
    return 'started'
  })
}

export function stopOnlineBackgroundLocation(): Promise<void> {
  return serial(() => stopOnlineUpdates())
}

/** Sign-out stops both services. */
export async function stopAllBackgroundLocation(): Promise<void> {
  await stopOnlineBackgroundLocation()
  await stopTripBackgroundLocation()
}

/** Called on launch/resume even when the driver has not reopened the trip screen. */
export function reconcileTripBackgroundLocation(): Promise<void> {
  return serial(async () => {
    if (!native) return
    const tripId = await authStorage.getItem(ACTIVE_TRIP_KEY)
    if (!tripId || !await activeTrip(tripId)) await stopUpdates()
  })
}
