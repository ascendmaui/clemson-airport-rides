import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { Pill, PrimaryButton } from '@/components/Button'
import { setAuthNext } from '@/lib/authNext'
import { useAuth } from '@/lib/auth'
import { oneParam } from '@/lib/oneParam'
import { createScheduledTrip, fetchScheduleSlots, type RidePlace } from '@/lib/scheduleApi'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'
import { RIDE_PLACES } from 'rides-native/riderShell.js'
import { NEAR_TERM_MAX_MINUTES, NEAR_TERM_MIN_MINUTES } from '../../../shared/nearTermSlots.js'

type TierId = 'standard' | 'wait' | 'comfort'
type Slot = { id: string; minutesOut: number; pickupAt: string; label: string }

const TIERS: Array<{ id: TierId; name: string }> = [
  { id: 'standard', name: 'Standard' },
  { id: 'wait', name: 'Wait & Save' },
  { id: 'comfort', name: 'Extra Comfort' },
]

function placeByLabel(label: string): RidePlace | null {
  return RIDE_PLACES.find((place) => place.label === label) || null
}

function isTier(value: string): value is TierId {
  return value === 'standard' || value === 'wait' || value === 'comfort'
}

/**
 * Item 9 slot picker. The looking-for-driver Schedule button opens
 * /schedule?near=1 and may pass pickup, dropoff, and tier labels.
 */
export function NearTermSlots() {
  const router = useRouter()
  const params = useLocalSearchParams<{ near?: string | string[]; pickup?: string | string[]; dropoff?: string | string[]; tier?: string | string[] }>()
  const { user } = useAuth()
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const highlighted = oneParam(params.near, '') === '1'
  const [pickup, setPickup] = useState<RidePlace>(placeByLabel(oneParam(params.pickup, '')) || RIDE_PLACES[0])
  const [dropoff, setDropoff] = useState<RidePlace>(placeByLabel(oneParam(params.dropoff, '')) || RIDE_PLACES[3])
  const initialTier = oneParam(params.tier, 'standard')
  const [tier, setTier] = useState<TierId>(isTier(initialTier) ? initialTier : 'standard')
  const [slots, setSlots] = useState<Slot[]>([])
  const [waitLabel, setWaitLabel] = useState<string | null>(null)
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const ready = pickup.label !== dropoff.label
  const selected = useMemo(() => slots.find((slot) => slot.id === selectedId) || null, [slots, selectedId])

  useEffect(() => {
    if (!ready) return undefined
    let alive = true
    const load = () => fetchScheduleSlots(pickup, tier)
      .then((next) => {
        if (!alive) return
        const nextSlots = next.slots || []
        setSlots(nextSlots)
        setWaitLabel(next.waitLabel)
        setEmptyMessage(nextSlots.length ? null : (next.emptyMessage || 'No pickup in the next 10 to 15 minutes.'))
        setSelectedId((current) => (nextSlots.some((slot) => slot.id === current) ? current : null))
        setError(null)
      })
      .catch((err: unknown) => {
        if (!alive) return
        setError(err instanceof Error ? err.message : 'Could not load pickup times')
      })
    load()
    const timer = setInterval(load, 15000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [ready, pickup, tier])

  async function book() {
    setSaved(null)
    if (!user) {
      setAuthNext('/schedule')
      router.push('/sign-in')
      return
    }
    if (!selected) {
      setError('Choose a pickup time.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await createScheduledTrip({
        user,
        pickup,
        dropoff,
        pickupAt: new Date(selected.pickupAt),
        purpose: 'planned',
        weekdays: [],
        tier,
        nearTerm: true,
      })
      setSaved('On the board. Drivers are notified. No card was charged.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not schedule ride')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={[styles.card, highlighted && { borderColor: colors.orange }]} accessibilityLabel="Leave in 10 to 15 minutes">
      <Text style={styles.kicker}>LEAVE SOON</Text>
      <Text style={styles.title}>Leave in {NEAR_TERM_MIN_MINUTES}–{NEAR_TERM_MAX_MINUTES} minutes</Text>
      <Text style={styles.copy}>Times follow the current wait from drivers who are online. Preview cars are not counted.</Text>
      <View style={styles.pills}>
        {TIERS.map((option) => (
          <Pill key={option.id} label={option.name} active={tier === option.id} onPress={() => setTier(option.id)} />
        ))}
      </View>
      <Text style={styles.label}>Pickup</Text>
      <View style={styles.pills}>
        {RIDE_PLACES.map((place) => (
          <Pill key={`near-pu-${place.label}`} label={place.label} active={pickup.label === place.label} onPress={() => setPickup(place)} />
        ))}
      </View>
      <Text style={styles.label}>Drop-off</Text>
      <View style={styles.pills}>
        {RIDE_PLACES.map((place) => (
          <Pill key={`near-do-${place.label}`} label={place.label} active={dropoff.label === place.label} onPress={() => setDropoff(place)} />
        ))}
      </View>
      {waitLabel ? <Text style={styles.wait}>Current wait {waitLabel}</Text> : null}
      {emptyMessage ? <Text style={styles.copy}>{emptyMessage}</Text> : null}
      <View style={styles.pills}>
        {slots.map((slot) => {
          const on = slot.id === selectedId
          return (
            <Pressable
              key={slot.id}
              onPress={() => setSelectedId(slot.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[styles.slot, on && styles.slotOn]}
            >
              <Text style={[styles.slotText, on && styles.slotTextOn]}>{slot.label}</Text>
            </Pressable>
          )
        })}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {saved ? <Text style={styles.saved}>{saved}</Text> : null}
      <PrimaryButton label={busy ? 'Scheduling…' : 'Schedule this pickup'} onPress={book} disabled={busy || !selected} />
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    card: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 14,
      marginBottom: 16,
    },
    kicker: { color: colors.orange, fontWeight: '800' as const, fontSize: 12, letterSpacing: 0.6 },
    title: { color: colors.purple, fontWeight: '800' as const, fontSize: 18, marginTop: 4 },
    copy: { color: colors.inkSecondary, fontSize: 13, lineHeight: 18, marginTop: 6 },
    label: { color: colors.inkSecondary, fontWeight: '700' as const, marginTop: 10, marginBottom: 6 },
    pills: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
    wait: { color: colors.purple, fontWeight: '800' as const, marginTop: 10 },
    slot: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: colors.purpleSoft },
    slotOn: { backgroundColor: colors.purple },
    slotText: { color: colors.purple, fontWeight: '700' as const },
    slotTextOn: { color: colors.onAccent },
    error: { color: colors.danger, fontWeight: '700' as const, marginVertical: 8 },
    saved: { color: colors.purple, fontWeight: '700' as const, marginVertical: 8 },
  }
}
