export const ORANGE: string
export const ORANGE_BRIGHT: string
export const PURPLE: string
export const INK: string
export const INK_SECONDARY: string
export const DANGER: string
export const SURFACE: string
export const CLEMSON: { latitude: number; longitude: number }
export const STADIUM: { latitude: number; longitude: number }
export const DOWNTOWN: { latitude: number; longitude: number }
export const GSP: { latitude: number; longitude: number }
export const CLT: { latitude: number; longitude: number }
export const SHORTCUTS: { id: string; label: string; sub: string; icon: string }[]
export const HEAT_WINDOWS: { id: string; label: string }[]
export const RIDE_TIERS: {
  id: string
  name: string
  icon: string
  eta: string
  meta: string
  price: number
  premium?: boolean
}[]
export function destPoint(label: string): { latitude: number; longitude: number }
export function formatUsd(amount: number): string
