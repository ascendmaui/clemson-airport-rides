import { useEffect, useRef, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { PrimaryButton } from '@/components/Button'
import { authedJson } from 'rides-native/apiClient'
import {
  fetchTripForRating,
  hasRatedTrip,
  ratingBlockReason,
  submitPartyRating,
} from 'rides-native/partyProfile.js'
import {
  AUTO_RIDER_STARS,
  defaultTipChoiceId,
  endScreenCanComplete,
  tipRecordBody,
} from 'rides-native/riderTripEnd.js'
import { formatCents } from 'rides-native/tripTags'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

type TipPreset = {
  id: string
  percent: number | null
  cents: number
  popular?: boolean
}

type TipOffer = {
  presets?: TipPreset[]
  popularId?: string | null
  choice?: { skipped?: boolean; tipCents?: number } | null
  chargedTipCents?: number
  driverName?: string | null
  fareCents?: number | null
  custom?: { minCents?: number; maxCents?: number }
}

export function RiderTripEnd({
  supabase,
  userId,
  tripId,
  onDone,
}: {
  supabase: { auth?: { getSession?: () => Promise<unknown> } } | null
  userId: string
  tripId: string
  onDone: () => void
}) {
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [stars, setStars] = useState(AUTO_RIDER_STARS)
  const [review, setReview] = useState('')
  const [choiceId, setChoiceId] = useState<string | null>(null)
  const [customDollars, setCustomDollars] = useState('')
  const [offer, setOffer] = useState<TipOffer | null>(null)
  const [offerError, setOfferError] = useState<string | null>(null)
  const [block, setBlock] = useState<string | null>(null)
  const [alreadyRated, setAlreadyRated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(true)
  const pickedTip = useRef(false)

  useEffect(() => {
    if (!supabase || !tripId || !userId) return undefined
    let alive = true
    setLoading(true)
    ;(async () => {
      try {
        const row = await fetchTripForRating(supabase, tripId)
        if (!alive) return
        const reason = ratingBlockReason(row, userId)
        if (reason) {
          setBlock(reason)
          setLoading(false)
          return
        }
        const rated = await hasRatedTrip(supabase, tripId, userId)
        if (!alive) return
        setAlreadyRated(Boolean(rated))
        const data = await authedJson(supabase, '/api/driver?action=tip-choice', {
          method: 'POST',
          body: { mode: 'offer', tripId },
        }) as TipOffer
        if (!alive) return
        setOffer(data)
        setOfferError(null)
        if (data?.choice || Number(data?.chargedTipCents) > 0) {
          if (rated) setDone(true)
        } else if (!pickedTip.current) {
          setChoiceId(defaultTipChoiceId(data))
        }
      } catch (err) {
        if (alive) setOfferError(err instanceof Error ? err.message : 'Could not load tip choices')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [supabase, tripId, userId])

  const needsTip = Boolean(offer) && !offer?.choice && !(Number(offer?.chargedTipCents) > 0)
  const presets = Array.isArray(offer?.presets) ? offer.presets : []
  const customMin = Number(offer?.custom?.minCents)
  const customMax = Number(offer?.custom?.maxCents)
  const customRange = Number.isFinite(customMin) && Number.isFinite(customMax)
    ? `${formatCents(customMin)} to ${formatCents(customMax)}`
    : '$1.00 to $100.00'

  function choosePreset(id: string) {
    pickedTip.current = true
    setChoiceId(id)
    if (id !== 'custom') setCustomDollars('')
    setError(null)
  }

  async function onComplete() {
    const ready = endScreenCanComplete({
      stars,
      choiceId,
      customDollars,
      needsTip,
    })
    if (!ready.ok) {
      setError(ready.error || 'Could not finish this trip')
      return
    }
    if (!supabase) return
    setBusy(true)
    setError(null)
    try {
      if (!alreadyRated) {
        await submitPartyRating(supabase, { tripId, raterId: userId, stars, comment: review })
        setAlreadyRated(true)
      }
      if (needsTip) {
        const tip = tipRecordBody(tripId, choiceId, customDollars)
        if (!tip.ok || !tip.body) {
          setError(tip.error || 'Pick a tip')
          return
        }
        await authedJson(supabase, '/api/driver?action=tip-choice', { method: 'POST', body: tip.body })
      }
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete this trip')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <Text style={styles.copy}>Loading your trip…</Text>
  }

  if (block) {
    return (
      <View style={styles.card}>
        <Text style={styles.kicker}>TRIP END</Text>
        <Text style={styles.title}>Not ready to finish</Text>
        <Text style={styles.copy}>{block}</Text>
      </View>
    )
  }

  if (done) {
    return (
      <View style={styles.card}>
        <Text style={styles.kicker}>TRIP END</Text>
        <Text style={styles.title}>Trip complete</Text>
        <Text style={styles.copy}>Your stars, review, and tip are saved.</Text>
        <PrimaryButton label="Done" onPress={onDone} />
      </View>
    )
  }

  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>TRIP END</Text>
      <Text style={styles.title}>How was {offer?.driverName || 'your driver'}?</Text>
      <Text style={styles.copy}>
        {alreadyRated
          ? 'Your rating is already saved. Add a tip, then complete the trip.'
          : 'Five stars is selected. Change it if you want. The review is optional.'}
      </Text>
      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((value) => (
          <Pressable
            key={value}
            onPress={() => {
              if (!alreadyRated) setStars(value)
            }}
            accessibilityRole="button"
            accessibilityLabel={`${value} star${value === 1 ? '' : 's'}`}
            accessibilityState={{ selected: stars === value }}
            hitSlop={8}
          >
            <Text style={[styles.star, { color: value <= stars ? colors.orange : colors.inkSecondary }]}>★</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.label}>Review</Text>
      <TextInput
        value={review}
        onChangeText={setReview}
        placeholder="Optional review"
        placeholderTextColor={colors.placeholder}
        style={styles.review}
        multiline
        accessibilityLabel="Optional review"
      />
      <Text style={styles.label}>Tip</Text>
      {offerError ? <Text style={styles.error}>{offerError}</Text> : null}
      {needsTip ? (
        <>
          <Text style={styles.copy}>
            {Number(offer?.fareCents) > 0
              ? `15%, 20%, or 25% of this trip’s ${formatCents(offer?.fareCents)} fare, or your own amount.`
              : 'Pick 15%, 20%, or 25% when the fare supports it, or enter a dollar amount.'}
          </Text>
          <View style={styles.tips} accessibilityRole="radiogroup">
            {presets.map((preset) => {
              const selected = choiceId === preset.id
              return (
                <Pressable
                  key={preset.id}
                  onPress={() => choosePreset(preset.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={preset.percent != null ? `${preset.percent} percent, ${formatCents(preset.cents)}` : formatCents(preset.cents)}
                  style={[styles.tip, selected && styles.tipOn]}
                >
                  <Text style={[styles.tipAmount, selected && styles.tipAmountOn]}>{formatCents(preset.cents)}</Text>
                  <Text style={[styles.tipPercent, selected && styles.tipAmountOn]}>
                    {preset.percent != null ? `${preset.percent}%` : 'Tip'}
                  </Text>
                </Pressable>
              )
            })}
          </View>
          <Text style={styles.label}>Custom amount</Text>
          <View style={[styles.custom, choiceId === 'custom' && styles.tipOn]}>
            <Text style={styles.dollar}>$</Text>
            <TextInput
              value={customDollars}
              onChangeText={(next) => {
                pickedTip.current = true
                setCustomDollars(next)
                setChoiceId('custom')
                setError(null)
              }}
              onFocus={() => choosePreset('custom')}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colors.placeholder}
              style={styles.customInput}
              accessibilityLabel="Custom tip amount in dollars"
            />
          </View>
          <Text style={styles.hint}>Any amount from {customRange}. A saved card is charged after you complete the trip. No card on file means nothing is charged.</Text>
          <Pressable
            onPress={() => choosePreset('skip')}
            accessibilityRole="button"
            accessibilityState={{ selected: choiceId === 'skip' }}
            hitSlop={8}
          >
            <Text style={[styles.skip, choiceId === 'skip' && styles.skipOn]}>No tip</Text>
          </Pressable>
        </>
      ) : (
        <Text style={styles.copy}>
          {offer?.choice?.skipped
            ? 'No tip on this trip.'
            : Number(offer?.chargedTipCents) > 0
              ? `${formatCents(offer?.chargedTipCents)} is already on this trip.`
              : offer?.choice
                ? 'Your tip choice is already saved.'
                : 'Tip choices load with this trip.'}
        </Text>
      )}
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <PrimaryButton
        label={busy ? 'Saving…' : 'Complete trip'}
        onPress={() => { void onComplete() }}
        disabled={busy || (needsTip && !choiceId)}
      />
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    card: {
      backgroundColor: colors.card,
      borderRadius: 22,
      padding: 16,
      gap: 10,
      borderWidth: 1,
      borderColor: colors.border,
    },
    kicker: {
      color: colors.orange,
      fontSize: 11,
      fontWeight: '800' as const,
      letterSpacing: 1.1,
    },
    title: {
      color: colors.purple,
      fontSize: 24,
      fontWeight: '800' as const,
      letterSpacing: -0.4,
    },
    copy: { color: colors.inkSecondary, fontSize: 14, lineHeight: 20 },
    stars: { flexDirection: 'row' as const, gap: 6 },
    star: { fontSize: 32, fontWeight: '800' as const },
    label: { color: colors.title, fontSize: 13, fontWeight: '700' as const },
    review: {
      minHeight: 88,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      paddingHorizontal: 14,
      paddingVertical: 12,
      color: colors.ink,
      backgroundColor: colors.input,
      textAlignVertical: 'top' as const,
      fontSize: 16,
    },
    tips: { flexDirection: 'row' as const, gap: 8 },
    tip: {
      flex: 1,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.purpleSoft,
      paddingVertical: 12,
      alignItems: 'center' as const,
    },
    tipOn: {
      borderColor: colors.orange,
      backgroundColor: colors.orangeSoft,
    },
    tipAmount: { color: colors.purple, fontSize: 16, fontWeight: '800' as const },
    tipAmountOn: { color: colors.orange },
    tipPercent: { color: colors.inkSecondary, fontSize: 12, fontWeight: '700' as const, marginTop: 2 },
    custom: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      backgroundColor: colors.input,
      paddingHorizontal: 12,
    },
    dollar: { color: colors.purple, fontSize: 18, fontWeight: '800' as const },
    customInput: { flex: 1, color: colors.ink, fontSize: 18, paddingVertical: 12, paddingHorizontal: 8 },
    hint: { color: colors.inkSecondary, fontSize: 12, lineHeight: 17 },
    skip: { color: colors.link, fontWeight: '700' as const, fontSize: 14 },
    skipOn: { color: colors.orange },
    error: { color: colors.danger, fontSize: 13, lineHeight: 18 },
  }
}
