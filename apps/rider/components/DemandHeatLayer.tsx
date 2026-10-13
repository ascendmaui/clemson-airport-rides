import { useId, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg'
import type { TigerHeatZone } from 'rides-native/tigerHeat.js'
import type { BusySpot } from '@/lib/busySpots'
import { demandPointsToHeat, framePercents, heatBloom } from '@/lib/demandHeatMap'
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
  const reactId = useId().replace(/:/g, '')
  const model = useMemo(
    () => demandPointsToHeat(enabled ? [...spots, ...zones] : [], { scheme }),
    [enabled, spots, zones, scheme],
  )
  const frames = useMemo(() => framePercents(model.points), [model])
  if (!model.points.length) return null
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.field}>
      {model.points.map((point, index) => {
        const spot = frames[index]
        if (!spot) return null
        const bloom = heatBloom(point.weight, model.opacity)
        const id = `dh-${reactId}-${index}`
        return (
          <Svg
            key={id}
            pointerEvents="none"
            width={bloom.size}
            height={bloom.size}
            style={{
              position: 'absolute',
              left: `${spot.left}%`,
              top: `${spot.top}%`,
              marginLeft: -bloom.size / 2,
              marginTop: -bloom.size / 2,
            }}
          >
            <Defs>
              <RadialGradient id={id} cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor={bloom.coreColor} stopOpacity={bloom.coreOpacity} />
                <Stop offset="42%" stopColor={bloom.midColor} stopOpacity={bloom.midOpacity} />
                <Stop offset="100%" stopColor="#F56600" stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx={bloom.size / 2} cy={bloom.size / 2} r={bloom.size / 2} fill={`url(#${id})`} />
          </Svg>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  field: { ...StyleSheet.absoluteFillObject },
})
