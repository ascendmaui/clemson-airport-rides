export type BusyRosterDriver = {
  id: string
  name: string
  rating: string
  tripCount: number
  make: string
  model: string
  color: string
  vehicleLabel: string
  online: false
  bookable: false
  status: 'on_trip' | 'unavailable'
  statusLabel: 'On a trip' | 'Unavailable'
}
export function busyRosterFor(options?: { now?: number | Date; enabled?: boolean }): BusyRosterDriver[]
export function isBusyRosterId(id: unknown): boolean
