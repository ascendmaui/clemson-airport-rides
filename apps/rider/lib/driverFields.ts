import { failedHoldPrompt, paymentFailedMoment } from '../../../packages/rides-native/rideMoments.js'
import { trackingIssue } from '../../../packages/rides-native/tracking.js'

/** Read a driver string. Blank, null, and non-strings become the fallback. */
export function textField(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed) return trimmed
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return fallback
}

/** Trip counts from the network or the roster may be missing. Never call toLocaleString on those. */
export function tripCountLabel(value: unknown): string {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
  if (!Number.isFinite(numeric) || numeric < 0) return '0'
  return Math.trunc(numeric).toLocaleString('en-US')
}

export function ratingLabel(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(1)
  if (typeof value === 'string' && value.trim()) return value.trim()
  return '—'
}

export type RosterCard = {
  id: string
  name: string
  rating: string
  tripCountLabel: string
  vehicleLabel: string
  status: string
  statusLabel: string
}

/** Display-only busy roster row. A null or partial driver is skipped instead of throwing in map. */
export function rosterCard(driver: unknown): RosterCard | null {
  if (!driver || typeof driver !== 'object') return null
  const row = driver as Record<string, unknown>
  const id = textField(row.id, '')
  if (!id) return null
  return {
    id,
    name: textField(row.name, 'Driver'),
    rating: ratingLabel(row.rating),
    tripCountLabel: tripCountLabel(row.tripCount),
    vehicleLabel: textField(row.vehicleLabel, 'Vehicle'),
    status: typeof row.status === 'string' ? row.status : '',
    statusLabel: textField(row.statusLabel, ''),
  }
}

/** Drop null rows and fill the fields the picker renders. */
export function sanitizeOnlineDrivers<T extends { id?: unknown }>(rows: unknown): T[] {
  if (!Array.isArray(rows)) return []
  const out: T[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const source = row as T & Record<string, unknown>
    const id = textField(source.id, '')
    if (!id) continue
    out.push({
      ...source,
      id,
      name: textField(source.name, 'Driver'),
      vehicleLabel: textField(source.vehicleLabel, 'Vehicle'),
      online: Boolean(source.online),
      plate: typeof source.plate === 'string' && source.plate.trim() ? source.plate : null,
    } as T)
  }
  return out
}

type CounterpartShape = {
  name?: unknown
  roleLabel?: unknown
  initial?: unknown
  ratingLine?: unknown
  spots?: unknown
  vehicleLine?: unknown
  bio?: unknown
  rideStyle?: unknown
}

/** Counterpart card fields that throw when the matched driver row is partial. */
export function safeCounterpart<T extends CounterpartShape>(person: T | null | undefined): T | null {
  if (!person || typeof person !== 'object') return null
  const name = textField(person.name, 'Driver')
  const spots = Array.isArray(person.spots)
    ? person.spots.filter((spot): spot is string => typeof spot === 'string' && spot.trim().length > 0)
    : []
  return {
    ...person,
    name,
    roleLabel: textField(person.roleLabel, 'Driver'),
    initial: textField(person.initial, name.slice(0, 1).toUpperCase() || '?'),
    ratingLine: typeof person.ratingLine === 'string' ? person.ratingLine : '',
    spots,
    vehicleLine: typeof person.vehicleLine === 'string' ? person.vehicleLine : '',
    bio: typeof person.bio === 'string' ? person.bio : '',
    rideStyle: typeof person.rideStyle === 'string' ? person.rideStyle : '',
  } as T
}

export function guardValue<T>(read: () => T, fallback: T): T {
  try {
    return read()
  } catch {
    return fallback
  }
}

export function readHoldPrompt(trip: unknown) {
  return guardValue(() => failedHoldPrompt(trip), null)
}

export function readPaymentFailedMoment(prevHold: unknown, row: unknown, role: 'rider' | 'driver' = 'rider') {
  return guardValue(() => paymentFailedMoment(prevHold, row, role), null)
}

export function readTrackingIssue(status: unknown, timestamp: unknown, now?: number, heartbeatAt?: unknown) {
  return guardValue(() => trackingIssue(status, timestamp, now, heartbeatAt), null)
}
