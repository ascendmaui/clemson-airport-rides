import * as Location from 'expo-location'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import {
  catalogStops,
  clusterOf,
  hotCatalogPlaces,
  neighborhoodsInGroup,
  placeOf,
  searchCatalogPlaces,
  type NeighborhoodGroup,
  type Place,
} from 'rides-native/shared/carpool.js'
import { EmptyState } from '@/components/carpool/ui'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

type GroupFilter = NeighborhoodGroup['id'] | 'airports' | 'all'

const FILTERS: { id: GroupFilter; label: string }[] = [
  { id: 'housing', label: 'Housing' },
  { id: 'bars', label: 'Bars' },
  { id: 'campus', label: 'Campus' },
  { id: 'airports', label: 'Airports' },
  { id: 'all', label: 'All' },
]

function stopsForGroup(group: GroupFilter): { id: string; label: string; lat: number; lng: number }[] {
  switch (group) {
    case 'airports':
      return catalogStops().filter((stop) => stop.kind === 'airport')
    case 'all':
      return catalogStops()
    case 'housing':
    case 'bars':
    case 'campus':
      return neighborhoodsInGroup(group)
    default: {
      const exhaustive: never = group
      return exhaustive
    }
  }
}

export function NeighborhoodPicker({
  label,
  value,
  onChange,
}: {
  label: string
  value: Place
  onChange: (next: Place) => void
}) {
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<GroupFilter>('housing')
  const [locating, setLocating] = useState(false)
  const [locateNote, setLocateNote] = useState<string | null>(null)
  const hot = useMemo(() => hotCatalogPlaces(), [])
  const results = useMemo(() => searchCatalogPlaces(query), [query])
  const listed = query.trim() ? results : stopsForGroup(group)
  const cluster = clusterOf(value)
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const locateLabel = /drop/i.test(label)
    ? 'Use current location as drop-off'
    : 'Use current location as pickup'

  async function onLocate() {
    setLocating(true)
    setLocateNote(null)
    try {
      const permission = await Location.requestForegroundPermissionsAsync()
      if (permission.status !== 'granted') {
        setLocateNote('Location permission is off.')
        return
      }
      let position
      try {
        position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation })
      } catch {
        position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      }
      const lat = position.coords.latitude
      const lng = position.coords.longitude
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        setLocateNote('Could not read your location.')
        return
      }
      onChange({ label: 'Current location', lat, lng })
      setQuery('')
    } catch (err) {
      setLocateNote(err instanceof Error ? err.message : 'Could not read your location.')
    } finally {
      setLocating(false)
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Grand Marc, stadium, GSP…"
          placeholderTextColor={colors.placeholder}
          autoCorrect={false}
          autoCapitalize="words"
          style={styles.search}
          accessibilityLabel={`Search ${label.toLowerCase()}`}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={locateLabel}
          accessibilityHint="Pins your current location on the map"
          accessibilityState={{ busy: locating }}
          hitSlop={8}
          disabled={locating}
          onPress={() => { void onLocate() }}
          style={styles.locate}
        >
          <Text style={styles.locateText}>{locating ? '…' : '◎'}</Text>
        </Pressable>
      </View>
      {locateNote ? <Text style={styles.locateNote}>{locateNote}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {hot.map((spot: { id: string; label: string; lat: number; lng: number }) => (
          <Chip key={spot.id} spot={spot} selected={value.label === spot.label} onPress={() => onChange(placeOf(spot))} />
        ))}
      </ScrollView>
      <View style={styles.filters}>
        {FILTERS.map((item: { id: string; label: string }) => {
          const on = !query.trim() && group === item.id
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              accessibilityHint={`Shows ${item.label.toLowerCase()} stops`}
              accessibilityState={{ selected: on }}
              hitSlop={10}
              onPress={() => {
                setQuery('')
                setGroup(item.id)
              }}
              style={[styles.filter, on && styles.filterOn]}
            >
              <Text style={[styles.filterText, on && styles.filterTextOn]}>{item.label}</Text>
            </Pressable>
          )
        })}
      </View>
      {query.trim() && results.length === 0 ? (
        <EmptyState title="No campus or airport match" body="Try Grand Marc, College Ave, the stadium, a downtown bar, or GSP." />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {listed.map((spot: { id: string; label: string; lat: number; lng: number }) => (
            <Chip key={`list-${spot.id}`} spot={spot} selected={value.label === spot.label} onPress={() => onChange(placeOf(spot))} />
          ))}
        </ScrollView>
      )}
      <Text style={styles.cluster}>
        {cluster ? `Cluster · ${cluster.label}` : 'Outside the named Clemson clusters'}
      </Text>
    </View>
  )
}

function Chip({ spot, selected, onPress }: { key?: string | number; spot: { id: string; label: string; lat?: number; lng?: number }; selected: boolean; onPress: () => void }) {
  const styles = useThemedStyles(makeStyles)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spot.label}
      accessibilityHint="Selects this stop"
      accessibilityState={{ selected }}
      hitSlop={8}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipOn]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{spot.label}</Text>
    </Pressable>
  )
}

function makeStyles(colors: Palette) {
  return {
    wrap: { marginBottom: 8 },
    label: { fontSize: 13, fontWeight: '700' as const, letterSpacing: 0.1, color: colors.title, marginBottom: 8 },
    searchRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 8,
      marginBottom: 12,
    },
    search: {
      flex: 1,
      backgroundColor: colors.input,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 16,
      color: colors.ink,
    },
    locate: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      backgroundColor: colors.orangeSoft,
      borderWidth: 1,
      borderColor: colors.orange,
    },
    locateText: { color: colors.orange, fontSize: 20, fontWeight: '800' as const },
    locateNote: { color: colors.danger, fontSize: 12, lineHeight: 17, marginTop: -6, marginBottom: 8 },
    row: { gap: 8, paddingBottom: 8 },
    chip: {
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.chip,
    },
    chipOn: { backgroundColor: colors.purple, borderColor: colors.purple },
    chipText: { color: colors.link, fontWeight: '700' as const, fontSize: 12 },
    chipTextOn: { color: colors.onAccent },
    filters: { flexDirection: 'row' as const, gap: 8, marginBottom: 8 },
    filter: {
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: colors.purpleSoft,
    },
    filterOn: { backgroundColor: colors.orangeSoft },
    filterText: { color: colors.link, fontWeight: '700' as const, fontSize: 12 },
    filterTextOn: { color: colors.orange },
    cluster: { color: colors.inkSecondary, fontSize: 12, fontWeight: '700' as const, marginBottom: 8 },
  }
}
