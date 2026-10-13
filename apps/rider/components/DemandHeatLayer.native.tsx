import { useMemo } from 'react'
import { Platform } from 'react-native'
import { Heatmap, Overlay } from 'react-native-maps'
import type { TigerHeatZone } from 'rides-native/tigerHeat.js'
import type { BusySpot } from '@/lib/busySpots'
import {
  demandPointsToHeat,
  nativeDemandHeatSupported,
  renderDemandHeatImage,
} from '@/lib/demandHeatMap'
import type { Scheme } from '@/lib/palette'

export function DemandHeatLayer({
  spots,
  zones,
  scheme,
  enabled,
}: {
  spots: BusySpot[]
  zones: TigerHeatZone[]
  scheme: Scheme
  enabled: boolean
}) {
  const model = useMemo(
    () => demandPointsToHeat(enabled ? [...spots, ...zones] : [], { scheme }),
    [enabled, spots, zones, scheme],
  )
  const image = useMemo(
    () => (nativeDemandHeatSupported(Platform.OS) ? null : renderDemandHeatImage(model)),
    [model],
  )
  if (!model.points.length) return null
  if (nativeDemandHeatSupported(Platform.OS)) {
    return (
      <Heatmap
        points={model.points}
        radius={model.radius}
        opacity={model.opacity}
        gradient={model.gradient}
      />
    )
  }
  if (!image) return null
  return (
    <Overlay
      image={{ uri: image.uri }}
      bounds={image.bounds}
      pointerEvents="none"
    />
  )
}
