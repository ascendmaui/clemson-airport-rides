import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useCardShadow } from '@/components/chrome'
import { useAuth } from '@/lib/auth'
import type { Palette } from '@/lib/palette'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { setMyMarker } from '@/lib/myMarker'
import { firstRideChipCopy, loadDriverPerks, type DriverPerks, type Leaderboard, type StreakView, type SurgeView, type PartyQueueView, type SafetyScoreView, type ScorecardView, setPartyQueueOptIn } from 'rides-native/driverDesk'
import { failureToast, quiet } from '@/lib/softFail'
import { toggleWithRevert } from '@/lib/partyToggle'

const dollars = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`

/** Compact horizontal perk chips on Home. Each perk adds one chip here. */
export function PerksStrip() {
  const { user } = useAuth()
  const router = useRouter()
  const [perks, setPerks] = useState<DriverPerks | null>(null)
  const [partySaving, setPartySaving] = useState(false)
  const partyBusy = useRef(false)
  useFocusEffect(useCallback(() => {
    if (!user || !supabase) return undefined
    let alive = true
    loadDriverPerks(supabase).then((p) => {
      if (!alive) return
      setPerks(p)
      setMyMarker((p.scorecard as ScorecardView | undefined)?.marker)
    }).catch(quiet('perks load'))
    return () => { alive = false }
  }, [user]))
  if (!perks) return null
  const chips: ReactNode[] = []
  const ride = firstRideChipCopy(perks.firstRide)
  if (ride) chips.push(<PerkChip key="first-ride" title={ride.title} line={ride.line} tone={ride.tone} />)
  const surge = perks.surge as SurgeView | undefined
  if (surge?.enabled && surge.zones?.length) {
    const z = surge.zones[0]
    const when = z.live
      ? `Live until ${new Date(z.endsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : `${new Date(z.startsAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`
    chips.push(
      <Pressable key="surge" onPress={() => router.push('/surge')} accessibilityRole="button" accessibilityLabel={`Game-day surge zone ${z.label || z.title}. ${when}`}>
        <PerkChip title={`${z.live ? 'Surge now' : 'Surge soon'} · ${z.label || z.title}`} line={`${when}${surge.driverBonusCents ? ` · +${dollars(surge.driverBonusCents)}/trip` : ''}`} />
      </Pressable>,
    )
  }
  const party = perks.partyQueue as PartyQueueView | undefined
  if (party?.enabled) {
    const hours = `${party.startHour % 12 || 12}${party.startHour >= 12 ? 'pm' : 'am'}–${party.endHour % 12 || 12}${party.endHour >= 12 ? 'pm' : 'am'}`
    chips.push(
      <Pressable
        key="party"
        accessibilityRole="switch"
        accessibilityState={{ checked: party.optedIn }}
        accessibilityLabel={`Party-ride queue, ${party.label}. ${party.optedIn ? 'On' : 'Off'}`}
        accessibilityHint="Turns late-night party pickups on or off"
        accessibilityValue={partySaving ? { text: 'Saving' } : undefined}
        disabled={partySaving}
        onPress={function toggleParty() {
          if (!supabase) return
          const client = supabase
          const before = perks
          const next = !party.optedIn
          setPartySaving(true)
          void toggleWithRevert<DriverPerks>({
            current: before,
            next: { ...before, partyQueue: { ...party, optedIn: next } },
            apply: setPerks,
            save: () => setPartyQueueOptIn(client, next),
            reload: () => loadDriverPerks(client),
            busy: partyBusy,
            onFail: (err) => failureToast({
              key: 'party-queue',
              title: next ? 'Couldn’t join the party queue' : 'Couldn’t leave the party queue',
              err,
              fallback: `Party queue is still ${party.optedIn ? 'on' : 'off'}.`,
              retry: toggleParty,
            }),
            onReloadFail: quiet('party queue reload'),
          }).finally(() => setPartySaving(false))
        }}
      >
        <PerkChip
          title={`Party queue · ${partySaving ? 'Saving…' : party.optedIn ? 'On' : 'Off'}`}
          line={party.optedIn
            ? party.open ? `${party.label} · you’re #${party.position} of ${party.size}` : `${party.label} · opens ${hours}`
            : `Tap to join ${party.label} late-night pickups`}
        />
      </Pressable>,
    )
  }
  const card = perks.scorecard as ScorecardView | undefined
  if (card?.enabled) {
    const pct = (r: number | null | undefined) => (r == null ? '—' : `${Math.round(r * 100)}%`)
    const line = `Accept ${pct(card.acceptance?.rate)} · Complete ${pct(card.completion?.rate)} · Rating ${card.rating != null ? card.rating.toFixed(2) : '—'}`
    chips.unshift(
      <Pressable key="scorecard" onPress={() => router.push('/scorecard')} accessibilityRole="button" accessibilityLabel={`Scorecard. ${line}`}>
        <PerkChip title="Scorecard" line={line} />
      </Pressable>,
    )
  }
  const safety = perks.safety as SafetyScoreView | undefined
  if (safety?.enabled && typeof safety.score === 'number') {
    chips.push(
      <Pressable key="safety" onPress={() => router.push('/safety-score')} accessibilityRole="button" accessibilityLabel={`Estimated safety score ${safety.score}. ${safety.tips?.[0] || ''}`}>
        <PerkChip title={`Safety ${safety.score} · estimate`} line={safety.tips?.[0] || 'See tips'} />
      </Pressable>,
    )
  }
  const s = perks.streaks
  if (s?.trips?.enabled) chips.push(<StreakChip key="trips" label="Trip streak" unit="trips" view={s.trips} />)
  if (s?.days?.enabled) chips.push(<StreakChip key="days" label="Day streak" unit="days" view={s.days} />)
  const lb = perks.leaderboard as Leaderboard | undefined
  if (lb?.enabled && !lb.optedOut) {
    const me = lb.you?.trips
    chips.push(
      <Pressable key="leaderboard" onPress={() => router.push('/leaderboard')} accessibilityRole="button" accessibilityLabel="Weekly leaderboard" accessibilityHint="Opens this week's leaderboard">
        <PerkChip title="Weekly leaders" line={me ? `You’re #${me.rank} by trips` : 'See this week’s top drivers'} />
      </Pressable>,
    )
  }
  if (!chips.length) return null
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} accessibilityLabel="Driver perks">
      {chips}
    </ScrollView>
  )
}

export function PerkChip({ title, line, progress, tone, accessibilityLabel }: { title: string; line: string; progress?: number; tone?: 'orange' | 'purple'; accessibilityLabel?: string }) {
  const { colors } = useTheme()
  const shadow = useCardShadow()
  const accent = toneColor(colors, tone)
  return (
    <View
      style={[styles.chip, shadow, {
        backgroundColor: tone === 'orange' ? colors.orangeSoft : tone === 'purple' ? colors.purpleSoft : colors.card,
        // Brand rail on every chip: orange for money/urgent, purple otherwise.
        borderLeftWidth: 3,
        borderLeftColor: tone === 'orange' ? colors.orange : colors.purple,
      }]}
      accessible
      accessibilityLabel={accessibilityLabel || `${title}. ${line}`}
    >
      <Text style={{ color: accent, fontWeight: '800', fontSize: 13 }}>{title}</Text>
      <Text style={{ color: colors.inkSecondary, fontSize: 12 }}>{line}</Text>
      {progress != null ? (
        <View style={[styles.track, { backgroundColor: colors.track }]}>
          <View style={[styles.fill, { backgroundColor: colors.orange, width: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` }]} />
        </View>
      ) : null}
    </View>
  )
}

function toneColor(colors: Palette, tone?: 'orange' | 'purple') {
  switch (tone) {
    case 'orange':
      return colors.orange
    case 'purple':
      // Text on dark cards: the lighter brand purple keeps contrast at night.
      return colors.link
    case undefined:
      return colors.title
    default: {
      const unknown: never = tone
      return unknown
    }
  }
}

function StreakChip({ label, unit, view }: { label: string; unit: string; view: StreakView }) {
  const done = view.target - view.toNext
  return (
    <PerkChip
      title={`${label} ${done}/${view.target}`}
      line={`${view.toNext} more ${unit} for ${dollars(view.bonusCents)}`}
      progress={view.progress}
    />
  )
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingHorizontal: 16, paddingVertical: 6 },
  chip: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, minWidth: 150, gap: 2 },
  track: { height: 4, borderRadius: 2, marginTop: 4, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
})
