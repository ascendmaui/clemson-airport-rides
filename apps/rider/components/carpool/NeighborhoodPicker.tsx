import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import {
  clusterOf,
  hotNeighborhoods,
  neighborhoodsInGroup,
  placeOf,
  searchNeighborhoods,
  type Neighborhood,
  type NeighborhoodGroup,
  type Place,
} from 'rides-native/shared/carpool.js'
import { INK, INK_SECONDARY, ORANGE, PURPLE } from 'rides-native/places.js'
import { EmptyState } from '@/components/carpool/ui'

type GroupFilter = NeighborhoodGroup['id'] | 'all'

const FILTERS: { id: GroupFilter; label: string }[] = [
  { id: 'housing', label: 'Housing' },
  { id: 'bars', label: 'Bars' },
  { id: 'campus', label: 'Campus' },
  { id: 'all', label: 'All' },
]

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
  const hot = useMemo(() => hotNeighborhoods(), [])
  const results = useMemo(() => searchNeighborhoods(query), [query])
  const listed = query.trim() ? results : neighborhoodsInGroup(group)
  const cluster = clusterOf(value)

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Grand Marc, stadium, bars…"
        placeholderTextColor="#8B939E"
        autoCorrect={false}
        autoCapitalize="words"
        style={styles.search}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {hot.map((spot) => (
          <Chip key={spot.id} spot={spot} selected={value.label === spot.label} onPress={() => onChange(placeOf(spot))} />
        ))}
      </ScrollView>
      <View style={styles.filters}>
        {FILTERS.map((item) => {
          const on = !query.trim() && group === item.id
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
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
        <EmptyState title="No neighborhood match" body="Try Grand Marc, College Ave, the stadium, a downtown bar, or a housing name." />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {listed.map((spot) => (
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

function Chip({ spot, selected, onPress }: { spot: Neighborhood; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipOn]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{spot.label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 8 },
  label: { fontSize: 12, fontWeight: '800', color: INK, marginBottom: 8 },
  search: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(82,45,128,0.18)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: INK,
    marginBottom: 10,
  },
  row: { gap: 8, paddingBottom: 8 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: 'rgba(82,45,128,0.25)',
    backgroundColor: '#fff',
  },
  chipOn: { backgroundColor: PURPLE, borderColor: PURPLE },
  chipText: { color: PURPLE, fontWeight: '700', fontSize: 12 },
  chipTextOn: { color: '#fff' },
  filters: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  filter: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(82,45,128,0.06)',
  },
  filterOn: { backgroundColor: 'rgba(245,102,0,0.14)' },
  filterText: { color: PURPLE, fontWeight: '700', fontSize: 12 },
  filterTextOn: { color: ORANGE },
  cluster: { color: INK_SECONDARY, fontSize: 12, fontWeight: '700', marginBottom: 8 },
})
