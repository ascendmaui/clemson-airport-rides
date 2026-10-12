import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { loadCommunityMatches } from './community.js'

/**
 * "Both from Greenville" chips for a trip. Renders nothing unless both people
 * opted into a field and it matches. Display only: never feeds matching,
 * price, or ETA.
 */
export function CommunityMatchChips({ supabase, tripId, colors = {}, compact = false }) {
  const [lines, setLines] = useState([])
  useEffect(() => {
    let alive = true
    setLines([])
    loadCommunityMatches(supabase, tripId).then((rows) => { if (alive) setLines(rows) })
    return () => { alive = false }
  }, [supabase, tripId])
  if (!lines.length) return null
  return (
    <View
      accessibilityLabel={`In common: ${lines.map((l) => l.label).join(', ')}`}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: compact ? 4 : 8 }}
    >
      {lines.map((l) => (
        <View key={l.category} style={{ borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: colors.purpleSoft || 'rgba(82,45,128,0.12)' }}>
          <Text style={{ color: colors.purple || '#522D80', fontWeight: '700', fontSize: compact ? 12 : 13 }}>{l.label}</Text>
        </View>
      ))}
    </View>
  )
}
