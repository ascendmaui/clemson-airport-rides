import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { Card, ErrorText } from '@/components/chrome'
import { StackPage } from '@/components/shell'
import { setMyMarker } from '@/lib/myMarker'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { loadDriverPerks, setMapMarker, type ScorecardView } from 'rides-native/driverDesk'
import { MARKER_CATALOG, catalogEntry } from '../../../shared/perks/scorecard.js'

const pct = (r: number | null | undefined) => (r == null ? '—' : `${Math.round(r * 100)}%`)
const METRIC: Record<string, (t: number) => string> = {
  trips: (t) => `${t} trips`,
  rating: (t) => `${t}+ rating`,
  completion: (t) => `${Math.round(t * 100)}% completion`,
  acceptance: (t) => `${Math.round(t * 100)}% acceptance`,
}

export default function ScorecardScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const [card, setCard] = useState<ScorecardView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    if (!supabase) return
    loadDriverPerks(supabase).then((p) => {
      const c = (p.scorecard as ScorecardView) || null
      setCard(c)
      setMyMarker(c?.marker)
    }).catch((e: Error) => setError(e.message))
  }, [])
  useFocusEffect(useCallback(() => { load(); return undefined }, [load]))

  const choose = async (key: string) => {
    if (!supabase || !card?.marker) return
    const next = key.startsWith('icon:') ? { style: card.marker.style, icon: key } : { style: key, icon: card.marker.icon }
    const r = await setMapMarker(supabase, next).catch((e: Error) => ({ ok: false, error: e.message }))
    if (r.ok) load()
    else setError(r.error === 'locked' ? 'Reach the milestone to unlock that marker.' : r.error || 'Could not save marker')
  }
  const unlocked = new Set(card?.unlocked || [])
  const styles = [...Object.keys(MARKER_CATALOG.colors).map((k) => `color:${k}`), ...Object.keys(MARKER_CATALOG.liveries).map((k) => `livery:${k}`)]
  const icons = Object.keys(MARKER_CATALOG.icons).map((k) => `icon:${k}`)

  const Option = ({ k }: { k: string }) => {
    const e = catalogEntry(k) as { label: string; fill?: string; accent?: string; glyph?: string }
    const open = unlocked.has(k)
    const selected = card?.marker?.style === k || card?.marker?.icon === k
    return (
      <Pressable
        onPress={() => open && choose(k)}
        disabled={!open}
        accessibilityRole="button"
        accessibilityLabel={`${e.label}${open ? '' : ', locked'}`}
        accessibilityState={{ selected, disabled: !open }}
        style={{ alignItems: 'center', width: 76, gap: 4, opacity: open ? 1 : 0.4 }}
      >
        <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: e.fill || card?.marker?.fill || colors.orange, borderWidth: selected ? 3 : 1, borderColor: selected ? colors.orange : (e.accent || colors.track) }}>
          <Ionicons name={(e.glyph || card?.marker?.glyph || 'car') as keyof typeof Ionicons.glyphMap} size={18} color="#FFFFFF" />
        </View>
        <Text style={{ color: colors.inkSecondary, fontSize: 11, textAlign: 'center' }}>{open ? e.label : `Locked · ${e.label}`}</Text>
      </Pressable>
    )
  }

  return (
    <StackPage title="Scorecard" onBack={() => router.back()}>
      <Card>
        <Text style={{ color: colors.orange, fontWeight: '800', letterSpacing: 1.1, fontSize: 12 }}>{`LAST ${card?.windowDays ?? 30} DAYS`}</Text>
        <Text style={{ color: colors.title, fontWeight: '800' }}>{`Acceptance ${pct(card?.acceptance?.rate)}`}</Text>
        <Text style={{ color: colors.inkSecondary }}>{`${card?.acceptance?.accepted ?? 0} of ${card?.acceptance?.offered ?? 0} offers (up to the last 100)`}</Text>
        <Text style={{ color: colors.title, fontWeight: '800' }}>{`Completion ${pct(card?.completion?.rate)}`}</Text>
        <Text style={{ color: colors.inkSecondary }}>{`${card?.completion?.completed ?? 0} of ${card?.completion?.eligible ?? 0} accepted trips; rider cancels don’t count`}</Text>
        <Text style={{ color: colors.title, fontWeight: '800' }}>{`Rating ${card?.rating != null ? card.rating.toFixed(2) : '—'}`}</Text>
        <Text style={{ color: colors.inkSecondary }}>{`${card?.ratingCount ?? 0} ratings · ${card?.lifetimeTrips ?? 0} lifetime trips`}</Text>
      </Card>
      <Card>
        <Text style={{ color: colors.title, fontWeight: '800' }}>Milestones</Text>
        {(card?.milestones || []).map((m) => (
          <Text key={m.id} style={{ color: m.reached ? colors.orange : colors.inkSecondary }}>
            {`${m.reached ? 'Met' : 'Open'} · ${(METRIC[m.metric] || String)(m.threshold)}`}
          </Text>
        ))}
      </Card>
      <Card>
        <Text style={{ color: colors.title, fontWeight: '800' }}>Your map marker</Text>
        <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>Cosmetic only. Riders may see it; it never changes matching, ETA or price.</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{styles.map((k) => <Option key={k} k={k} />)}</View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{icons.map((k) => <Option key={k} k={k} />)}</View>
      </Card>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </StackPage>
  )
}
