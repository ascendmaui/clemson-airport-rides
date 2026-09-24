import type { BusySpot } from '@/lib/busySpots'

export type MapKind = 'standard' | 'satellite' | 'hybrid'

export type MapPin = {
  id: string
  latitude: number
  longitude: number
  title: string
  color: string
  badge?: string
}

export type LatLng = { latitude: number; longitude: number }

export type CampusMapProps = {
  spots: BusySpot[]
  showHeat: boolean
  mapType?: MapKind
  theater?: boolean
  gameDay?: boolean
  gameDayLabel?: string | null
  surge?: boolean
  userCoordinate?: LatLng | null
  pins?: MapPin[]
  fitPins?: boolean
}

export type CampusMapHandle = {
  animateTo: (coord: LatLng, delta?: number) => void
}

export function mapKindLabel(kind: MapKind): string {
  switch (kind) {
    case 'standard':
      return 'Roadmap'
    case 'satellite':
      return 'Satellite'
    case 'hybrid':
      return 'Hybrid'
    default: {
      const exhaustive: never = kind
      return exhaustive
    }
  }
}
