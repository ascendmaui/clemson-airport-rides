import { useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Marker, Overlay } from 'react-native-maps'
import type { TigerHeatZone } from 'rides-native/tigerHeat.js'
import type { BusySpot } from '@/lib/busySpots'
import {
  busynessInk,
  demandPointsToHeat,
  heatBreathFrame,
  HEAT_BREATH_FRAMES,
  renderDemandHeatFrames,
} from '@/lib/demandHeatMap'
import type { Scheme } from '@/lib/palette'

const LABEL_OFFSET_LAT = 0.00065

function useHeatBreathFrame(active: boolean): number {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    if (!active) return undefined
    const started = Date.now()
    const id = setInterval(() => {
      const next = heatBreathFrame(Date.now() - started)
      setFrame((current) => (current === next ? current : next))
    }, 220)
    return () => clearInterval(id)
  }, [active])
  return frame
}

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
  const glowing = model.areas.some((area) => area.label !== 'Quiet')
  const frames = useMemo(() => renderDemandHeatFrames(model), [model])
  const frame = useHeatBreathFrame(glowing)
  if (!model.areas.length) return null
  const image = frames[frame] ?? frames[frames.length - 1]
  return (
    <>
      {image ? <Overlay image={{ uri: image.uri }} bounds={image.bounds} /> : null}
      {model.areas.map((area, index) => (
        <Marker
          key={`heat-area-${index}`}
          coordinate={{ latitude: area.latitude + LABEL_OFFSET_LAT, longitude: area.longitude }}
          anchor={{ x: 0.5, y: 1 }}
          tracksViewChanges={false}
          tappable={false}
        >
          <Text style={[styles.label, area.label === 'Quiet' ? styles.quiet : null, { color: busynessInk(area.label) }]}>
            {area.label}
          </Text>
        </Marker>
      ))}
    </>
  )
}

const styles = StyleSheet.create({
  label: {
    fontSize: 11,
    fontWeight: '700',
    textShadowColor: 'rgba(255,255,255,0.9)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 3,
  },
  quiet: {
    backgroundColor: 'transparent',
  },
})
