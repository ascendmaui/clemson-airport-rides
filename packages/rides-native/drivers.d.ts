export type OnlineDriver = {
  id: string
  name: string
  ratingAvg: number | null
  ratingCount: number
  standing: string
  phone: string | null
  avatarUrl: string | null
  online: boolean
  priorityMode: boolean
  lat: number | null
  lng: number | null
  heading: number | null
  unlockProgress: number | null
  unlockTarget: number | null
  updatedAt: string | null
  vehicle: Record<string, unknown> | null
  vehicleLabel: string
  plate: string | null
  isTesla: boolean
  tier: string
}

export type DriverApproach = {
  etaMin: number | null
  distanceMi: number | null
}

export type DriverCardCopy = DriverApproach & {
  etaLabel: string | null
  distanceLabel: string | null
  availability: string
  ratingLabel: string
}

export type FavoriteDriverSource = 'account' | 'phone' | 'none'

export type KeyValueStorage = {
  getItem: (key: string) => Promise<string | null> | string | null
  setItem: (key: string, value: string) => Promise<void> | void
}

export const PREFERRED_MATCH_COPY: string
export const PREFERRED_OFFLINE_COPY: string
export const PREFERRED_CANCELED_COPY: string
export const OPEN_POOL_COPY: string

export function preferredTripFields(driverId: string): { preferred_driver_id: string; match: 'preferred' }
export function normalizeFavoriteDriverIds(raw: unknown): string[]
export function driverApproach(
  driver: { lat?: number | null; lng?: number | null } | null | undefined,
  pickup: { lat?: number | null; lng?: number | null } | null | undefined,
): DriverApproach
export function formatDriverDistance(miles: number | null | undefined): string | null
export function driverAvailabilityLine(
  driver: { online?: boolean; priorityMode?: boolean; updatedAt?: string | null } | null | undefined,
  now?: Date,
): string
export function describeDriver(
  driver: OnlineDriver | { lat?: number | null; lng?: number | null; online?: boolean; priorityMode?: boolean; updatedAt?: string | null; ratingAvg?: number | null; ratingCount?: number } | null | undefined,
  pickup: { lat?: number | null; lng?: number | null } | null | undefined,
  now?: Date,
): DriverCardCopy
export function sortPreferredDrivers<T extends { id: string; online?: boolean; lat?: number | null; lng?: number | null; name?: string }>(
  drivers: T[] | null | undefined,
  favoriteIds: string[] | null | undefined,
  pickup: { lat?: number | null; lng?: number | null } | null | undefined,
): T[]
export function groupDriversForPicker<T extends { id: string; online?: boolean }>(
  drivers: T[] | null | undefined,
  favoriteIds: string[] | null | undefined,
): { preferred: T[]; online: T[] }
export function loadFavoriteDriverIds(
  supabase: unknown,
  storage: KeyValueStorage | null | undefined,
  userId: string | null | undefined,
): Promise<{ ids: string[]; source: FavoriteDriverSource; note: string | null }>
export function saveFavoriteDriverIds(
  supabase: unknown,
  storage: KeyValueStorage | null | undefined,
  userId: string | null | undefined,
  ids: string[],
): Promise<{ ids: string[]; persisted: boolean; note: string }>

export function fetchOnlineDrivers(supabase: unknown): Promise<{ drivers: OnlineDriver[]; error: string | null }>
export function fetchDriversByIds(
  supabase: unknown,
  ids: string[] | null | undefined,
): Promise<{ drivers: OnlineDriver[]; error: string | null }>

export function setDriverOnline(
  supabase: unknown,
  driverId: string,
  online: boolean,
): Promise<{ ok: boolean }>

export function fetchDriverApplication(
  supabase: unknown,
  driverId: string,
): Promise<{
  application: { onboarding_status?: string; rejection_reason?: string | null } | null
  error: string | null
}>

export function requestDriverTrip(
  supabase: unknown,
  input: {
    riderId: string
    driverId: string
    dest?: string
    destPoint?: { latitude: number; longitude: number }
    pickupLabel?: string
    pickupPoint?: { latitude: number; longitude: number }
    tier?: string
    isStudent?: boolean
  },
): Promise<{ id: string; status: string; driver_id: string; dropoff_label: string }>
