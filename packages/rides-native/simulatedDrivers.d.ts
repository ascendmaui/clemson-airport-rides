export const SIMULATED_DRIVER_COUNT: number
export const SIMULATED_FLEET_TICK_MS: number
export const SIMULATED_DRIVER_TITLE: string
export const SIMULATED_FLEET_BADGE: string
export const BUSY_MARKER_FILL: string

export type SimulatedRoutePoint = { lat: number; lng: number }

export type SimulatedDriver = {
  id: string
  area: string
  routeLabel: string
  cruiseMph: number
  phase: number
  route: SimulatedRoutePoint[]
  status: 'busy'
  bookable: false
  online: false
  periodMs: number
}

export type SimulatedFleetCar = {
  id: string
  area: string
  routeLabel: string
  status: 'busy'
  bookable: false
  online: false
  lat: number
  lng: number
  heading: number
  title: string
  description: string
  firstName?: string
  label?: string
  body?: string
  livery?: string
}

export type SimulatedTapResult = {
  booked: false
  charged: false
  notified: false
  matched: false
  status: 'busy' | null
}

export const SIMULATED_DRIVERS: readonly SimulatedDriver[]
export const SIMULATED_FLEET_BOUNDS: {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

export function simulatedDriverDescription(driver: { routeLabel: string }): string
export function isSimulatedDriverId(id: unknown): boolean
export function simulatedAlongTrackMeters(driverId: string, nowMs: number): number
export function simulatedFleetAt(nowMs: number): SimulatedFleetCar[]
export function simulatedFleetPercent(lat: number, lng: number): { left: number; top: number }
export function refuseSimulatedDriverTap(id: string): SimulatedTapResult
export function busyCarSvg(heading: number): string
