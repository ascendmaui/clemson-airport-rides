import { useEffect, useMemo, useRef } from 'react'
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native'
import type { TigerHeatZone } from 'rides-native/tigerHeat.js'
import type { BusySpot } from '@/lib/busySpots'
import {
  busynessInk,
  demandPointsToHeat,
  fieldPlacement,
  framePercents,
  placeHeatLabelPercents,
  HEAT_BREATH_LOW,
  HEAT_BREATH_MS,
  renderDemandHeatImage,
} from '@/lib/demandHeatMap'
import { heatLabelFor, type Scheme } from '@/lib/palette'

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
  useEffect(() => {
    if (!image) return undefined
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
  }, [breath, image])
  if (!model.areas.length) return null
  const imageOpacity = breath.interpolate({
    inputRange: [0, 1],
    outputRange: [HEAT_BREATH_LOW, 1],
  })
  const places = placeHeatLabelPercents(image
    ? model.areas.map((area) => fieldPlacement(area, image.bounds))
    : framePercents(model.areas))
  return (
    <View pointerEvents="none" style={styles.field}>
      {image ? (
        <Animated.Image
          source={{ uri: image.uri }}
          resizeMode="stretch"
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={[styles.field, { opacity: imageOpacity }]}
        />
      ) : null}
      {model.areas.map((area, index) => {
        const place = places[index]
        if (!place) return null
        return (
          <View
            key={`heat-area-${index}`}
            style={[styles.labelSlot, { left: `${place.left}%`, top: `${place.top}%` }]}
          >
            <Text style={[styles.label, area.label === 'Quiet' ? styles.quiet : null, { color: busynessInk(area.label), textShadowColor: heatLabelFor(scheme).shadow }]}>
              {area.label}
            </Text>
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
    marginTop: -10,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: 'transparent',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 3,
  },
  quiet: {
    backgroundColor: 'transparent',
  },
})
