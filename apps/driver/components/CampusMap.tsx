import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@/lib/theme'

export type MapPin = {
  id: string
  latitude: number
  longitude: number
  title: string
  pinColor?: string
}

export function CampusMap({
  center,
  colorScheme,
}: {
  pins?: MapPin[]
  center?: { latitude: number; longitude: number } | null
  route?: { latitude: number; longitude: number }[]
  colorScheme?: 'light' | 'dark'
  focusToken?: number
}) {
  const { colors, scheme } = useTheme()
  const mode = colorScheme || scheme
  return (
    <View style={[styles.map, { backgroundColor: mode === 'dark' ? colors.mapFallback : '#E4D7F2' }]}>
      <Text style={[styles.label, { color: colors.title }]}>Clemson campus</Text>
      <Text style={[styles.sub, { color: colors.title }]}>
        {center ? `${center.latitude.toFixed(3)}, ${center.longitude.toFixed(3)}` : 'Driver map'}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  map: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: { fontWeight: '800', fontSize: 18 },
  sub: { marginTop: 6, fontSize: 12 },
})
