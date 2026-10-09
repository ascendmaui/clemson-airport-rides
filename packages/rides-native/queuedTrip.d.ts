import type { DriverCard } from './tripTags'
export function projectQueuedTrip<T extends DriverCard | null>(card: T, actions?: Array<{ tripId: string; kind: 'status' | 'stop'; op: string; stopIndex?: number; queuedAt?: string }>): T
