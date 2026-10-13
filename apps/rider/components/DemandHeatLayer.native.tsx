import { useEffect, useMemo, useState } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import { Heatmap, Marker, Overlay, Polygon } from 'react-native-maps'
import type { TigerHeatZone } from 'rides-native/tigerHeat.js'
import type { BusySpot } from '@/lib/busySpots'
import {
  busiestGlowColor,
  busiestOutline,
  busynessColor,
  busynessInk,
  demandPointsToHeat,
  heatBreathFrame,
  heatBreathOpacity,
  HEAT_BREATH_FRAMES,
  nativeDemandHeatSupported,
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
  const nativeHeat = nativeDemandHeatSupported(Platform.OS)
  const frames = useMemo(
    () => (nativeHeat ? [] : renderDemandHeatFrames(model)),
    [nativeHeat, model],
  )
  const frame = useHeatBreathFrame(model.points.length > 0)
  const breath = HEAT_BREATH_FRAMES <= 1 ? 0 : frame / (HEAT_BREATH_FRAMES - 1)
  const busiest = model.areas.find((area) => area.busiest) ?? null
  const glow = useMemo(() => {
    if (!busiest) return null
    return {
      wide: busiestOutline(busiest, 1.28),
      tight: busiestOutline(busiest, 1),
    }
  }, [busiest])
  if (!model.points.length || !busiest || !glow) return null
  const wideStroke = busiestGlowColor(busiest.label, breath, 'wide')
  const tightStroke = busiestGlowColor(busiest.label, breath, 'tight')
  const labels = model.areas.map((area, index) => (
    <Marker
      key={`heat-area-${index}`}
      coordinate={{ latitude: area.latitude + LABEL_OFFSET_LAT, longitude: area.longitude }}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={false}
      tappable={false}
    >
      <View style={[styles.chip, { backgroundColor: busynessColor(area.label) }]}>
        <Text style={[styles.chipText, { color: busynessInk(area.label) }]}>{area.label}</Text>
      </View>
    </Marker>
  ))
  const outline = (
    <>
      <Polygon
        coordinates={glow.wide}
        strokeColor={wideStroke}
        strokeWidth={16}
        fillColor="rgba(0,0,0,0)"
        tappable={false}
      />
      <Polygon
        coordinates={glow.tight}
        strokeColor={tightStroke}
        strokeWidth={6}
        fillColor="rgba(0,0,0,0)"
        tappable={false}
      />
    </>
  )
  if (nativeHeat) {
    return (
      <>
        <Heatmap
          points={model.points}
          radius={model.radius}
          opacity={heatBreathOpacity(model.opacity, breath)}
          gradient={model.gradient}
        />
        {outline}
        {labels}
      </>
    )
  }
  const image = frames[frame] ?? frames[frames.length - 1]
  if (!image) return null
  return (
    <>
      <Overlay image={{ uri: image.uri }} bounds={image.bounds} />
      {outline}
      {labels}
    </>
  )
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '700',
  },
})
