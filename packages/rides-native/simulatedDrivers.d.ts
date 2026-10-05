export const SIMULATED_DRIVER_COUNT: number
export const SIMULATED_FLEET_TICK_MS: number
export const SIMULATED_DRIVER_TITLE: string
export const SIMULATED_FLEET_BADGE: string
export const BUSY_MARKER_FILL: string
export const DEMO_ORANGE: string
export const DEMO_PURPLE: string
export const DEMO_HIDE_RADIUS_M: number

export type SimulatedRoutePoint = { lat: number; lng: number }

export type SimulatedDriver = {
  id: string
  headshotId: string
  firstName: string
  year: number
  colorName: string
  make: string
  model: string
  body: 'suv' | 'truck' | 'cybertruck'
  base: string
  area: string
  routeLabel: string
  cruiseMph: number
  phase: number
  route: SimulatedRoutePoint[]
  status: 'busy'
  bookable: false
  online: false
  is_demo: true
  source: 'demo'
  periodMs: number
}

export type SimulatedFleetCar = {
  id: string
  headshotId: string
  firstName: string
  year: number
  colorName: string
  make: string
  model: string
  body: 'suv' | 'truck' | 'cybertruck'
  base: string
  area: string
  routeLabel: string
  status: 'busy'
  bookable: false
  online: false
  is_demo: true
  source: 'demo'
  lat: number
  lng: number
  heading: number
  title: string
  description: string
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

export function simulatedDriverLabel(driver: { firstName: string; colorName: string; make: string; model: string }): string
export function simulatedDriverDescription(driver: { firstName: string; colorName: string; make: string; model: string }): string
export function isSimulatedDriverId(id: unknown): boolean
export function simulatedAlongTrackMeters(driverId: string, nowMs: number): number
export function simulatedFleetAt(nowMs: number): SimulatedFleetCar[]
export function lerpHeading(from: number, to: number, t: number): number
export function visibleDemoCars<T extends { id?: string; lat: number; lng: number; is_demo?: boolean; bookable?: boolean }>(
  cars: T[] | null | undefined,
  realDrivers: Array<{ id?: string; lat?: number | null; lng?: number | null; is_demo?: boolean }> | null | undefined,
  radiusM?: number,
): T[]
export function simulatedFleetPercent(lat: number, lng: number): { left: number; top: number }
export function portraitKind(person: {
  id?: string | null
  is_demo?: boolean
  isDemo?: boolean
  headshotId?: string | null
  avatarUrl?: string | null
  avatar_url?: string | null
  name?: string | null
  firstName?: string | null
} | null | undefined): { kind: 'demo' | 'photo' | 'initials'; headshotId: string | null; letter: string | null; color: string | null }
export function refuseSimulatedDriverTap(id: string): SimulatedTapResult
export function demoCarSvg(car?: { heading?: number; body?: string; base?: string }): string
export function busyCarSvg(heading: number): string
