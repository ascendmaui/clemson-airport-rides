import * as Location from 'expo-location'
import * as TaskManager from 'expo-task-manager'
import { Platform } from 'react-native'
import { isActiveTripLocationStatus, newestTripLocation, shouldPublishTripLocation } from 'rides-native/backgroundLocation'
import { publishDriverLocation as writeDriverLocation } from 'rides-native/driverDesk'
import { authStorage } from './storage'
import { supabase } from './supabase'

export const DRIVER_TRIP_LOCATION_TASK = 'driver-trip-location'
const ACTIVE_TRIP_KEY = 'driver.active-trip-location'
const LAST_PUBLISH_KEY = 'driver.last-location-publish'
const native = Platform.OS === 'ios' || Platform.OS === 'android'

export type BackgroundLocationStatus = 'started' | 'foreground-denied' | 'background-denied' | 'inactive' | 'unsupported'
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

async function publish(client: unknown, driverId: string, fix: DriverLocationInput): Promise<void> {
  if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return
  const stored = await authStorage.getItem(LAST_PUBLISH_KEY)
  const lastPublishedAt = stored == null ? null : Number(stored)
  if (!shouldPublishTripLocation(lastPublishedAt, Date.now())) return
  await writeDriverLocation(client, driverId, fix)
  // Secure storage survives a headless JS restart, and is shared with foreground uploads.
  await authStorage.setItem(LAST_PUBLISH_KEY, String(Date.now()))
}

/** Same presence + trip telemetry publisher for both foreground driver screens. */
export function publishDriverLocation(client: unknown, driverId: string, fix: DriverLocationInput): Promise<void> {
  return serial(async () => {
    if (!supabase) return
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
      await publish(supabase, trip.driverId, {
        lat: location.coords.latitude,
        lng: location.coords.longitude,
        heading: location.coords.heading,
        speed: location.coords.speed,
        online: true,
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
        timeInterval: 5000,
        distanceInterval: 15,
        pausesUpdatesAutomatically: false,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'Clemson RIDES trip in progress',
          notificationBody: 'Sharing your location with your rider until the trip ends.',
        },
      })
    }
    return 'started'
  })
}

export function stopTripBackgroundLocation(expectedTripId?: string): Promise<void> {
  return serial(() => stopUpdates(expectedTripId))
}

/** Called on launch/resume even when the driver has not reopened the trip screen. */
export function reconcileTripBackgroundLocation(): Promise<void> {
  return serial(async () => {
    if (!native) return
    const tripId = await authStorage.getItem(ACTIVE_TRIP_KEY)
    if (!tripId || !await activeTrip(tripId)) await stopUpdates()
  })
}
