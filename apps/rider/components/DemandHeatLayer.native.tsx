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
  placeHeatLabels,
  renderDemandHeatFrames,
} from '@/lib/demandHeatMap'
import { heatLabelFor, type Scheme } from '@/lib/palette'

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
  const labels = placeHeatLabels(model.areas)
  if (!model.areas.length) return null
  const image = frames[frame] ?? frames[frames.length - 1]
  return (
    <>
      {image ? <Overlay image={{ uri: image.uri }} bounds={image.bounds} /> : null}
      {model.areas.map((area, index) => {
        const label = labels[index]
        if (!label) return null
        return (
          <Marker
            key={`heat-area-${index}`}
            coordinate={label}
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={false}
            tappable={false}
          >
            <View style={[styles.chip, { backgroundColor: heatLabelFor(scheme).chip }]}>
              <Text style={[styles.label, area.label === 'Quiet' ? styles.quiet : null, { color: busynessInk(area.label), textShadowColor: heatLabelFor(scheme).shadow }]}>
                {area.label}
              </Text>
            </View>
          </Marker>
        )
      })}
    </>
  )
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 3,
  },
  quiet: {
    backgroundColor: 'transparent',
  },
})
