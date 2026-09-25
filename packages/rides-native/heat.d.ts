export const DOWNTOWN_VENUES: { id: string; name: string; lat: number; lng: number; radius: number; curve: string }[]
export const CAMPUS_ANCHORS: { id: string; name: string; lat: number; lng: number; radius: number; curve: string }[]

export function heatColor(intensity: number): string
export function downtownNow(date?: Date): {
  day: number
  hour: number
  avg: number
  label: string
  spots: { id: string; name: string; lat: number; lng: number; radius: number; intensity: number }[]
}
export function previewDate(windowId: string, now?: Date): Date
export function typicalSpots(date?: Date): {
  id: string
  name: string
  lat: number
  lng: number
  radius: number
  intensity: number
  source: string
}[]
export function resolveDemandRange(windowId?: string, now?: Date): {
  from: Date
  to: Date
  hourStart: number | null
  hourEnd: number | null
}
