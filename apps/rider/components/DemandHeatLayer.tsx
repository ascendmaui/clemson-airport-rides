import { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, Image, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native'
import Svg, { Ellipse } from 'react-native-svg'
import type { TigerHeatZone } from 'rides-native/tigerHeat.js'
import type { BusySpot } from '@/lib/busySpots'
import {
  busynessColor,
  busynessInk,
  demandPointsToHeat,
  fieldPlacement,
  HEAT_BREATH_LOW,
  HEAT_BREATH_MS,
  renderDemandHeatImage,
  type HotArea,
} from '@/lib/demandHeatMap'
import type { Scheme } from '@/lib/palette'

type Box = { width: number; height: number }

function glowEllipse(area: HotArea, bounds: [[number, number], [number, number]], box: Box, scale: number) {
  const place = fieldPlacement(area, bounds)
  return {
    cx: (place.left / 100) * box.width,
    cy: (place.top / 100) * box.height,
    rx: ((place.width / 2) / 100) * box.width * scale,
    ry: ((place.height / 2) / 100) * box.height * scale,
  }
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
  const image = useMemo(() => renderDemandHeatImage(model), [model])
  const breath = useRef(new Animated.Value(0)).current
  const [box, setBox] = useState<Box>({ width: 0, height: 0 })
  useEffect(() => {
    if (!model.points.length) return undefined
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1,
          duration: HEAT_BREATH_MS / 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
        Animated.timing(breath, {
          toValue: 0,
          duration: HEAT_BREATH_MS / 2,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [breath, model.points.length])
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout
    setBox((current) => (current.width === width && current.height === height ? current : { width, height }))
  }
  if (!model.points.length || !image) return null
  const busiest = model.areas.find((area) => area.busiest) ?? null
  const imageOpacity = breath.interpolate({
    inputRange: [0, 1],
    outputRange: [HEAT_BREATH_LOW, 1],
  })
  const glowOpacity = breath.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 0.9],
  })
  const wide = busiest && box.width > 0 ? glowEllipse(busiest, image.bounds, box, 1.28) : null
  const tight = busiest && box.width > 0 ? glowEllipse(busiest, image.bounds, box, 1) : null
  return (
    <View pointerEvents="none" style={styles.field} onLayout={onLayout}>
      <Animated.Image
        source={{ uri: image.uri }}
        resizeMode="stretch"
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={[styles.field, { opacity: imageOpacity }]}
      />
      {busiest && wide && tight ? (
        <Animated.View pointerEvents="none" style={[styles.field, { opacity: glowOpacity }]}>
          <Svg width={box.width} height={box.height}>
            <Ellipse
              cx={wide.cx}
              cy={wide.cy}
              rx={wide.rx}
              ry={wide.ry}
              stroke={busynessColor(busiest.label)}
              strokeWidth={16}
              strokeOpacity={0.35}
              fill="none"
            />
            <Ellipse
              cx={tight.cx}
              cy={tight.cy}
              rx={tight.rx}
              ry={tight.ry}
              stroke={busynessColor(busiest.label)}
              strokeWidth={6}
              strokeOpacity={0.8}
              fill="none"
            />
          </Svg>
        </Animated.View>
      ) : null}
      {model.areas.map((area, index) => {
        const place = fieldPlacement(area, image.bounds)
        return (
          <View
            key={`heat-area-${index}`}
            style={[styles.labelSlot, { left: `${place.left}%`, top: `${place.top}%` }]}
          >
            <View style={[styles.chip, { backgroundColor: busynessColor(area.label) }]}>
              <Text style={[styles.chipText, { color: busynessInk(area.label) }]}>{area.label}</Text>
            </View>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  field: { ...StyleSheet.absoluteFillObject },
  labelSlot: {
    position: 'absolute',
    width: 78,
    marginLeft: -39,
    marginTop: -36,
    alignItems: 'center',
  },
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
