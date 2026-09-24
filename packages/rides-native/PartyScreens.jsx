import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useRouter, useSegments } from 'expo-router'
import {
  RIDE_STYLES,
  findPendingRating,
  formatRatingLine,
  isProfileComplete,
  loadCounterpart,
  loadOwnProfile,
  profileFieldError,
  saveOwnProfile,
  shouldLeaveProfileSetup,
  shouldRedirectToProfileSetup,
  submitPartyRating,
  fetchTripForRating,
  hasRatedTrip,
  ratingBlockReason,
} from './partyProfile.js'

export const LIGHT_PARTY = {
  background: '#F7F4F0',
  card: '#FFFFFF',
  ink: '#0B1220',
  inkSecondary: '#5C6570',
  title: '#522D80',
  orange: '#F56600',
  purple: '#522D80',
  onAccent: '#FFFFFF',
  border: 'rgba(82,45,128,0.14)',
  danger: '#B42318',
}

export function partyColorsFromPalette(colors) {
  if (!colors) return LIGHT_PARTY
  return {
    background: colors.background || LIGHT_PARTY.background,
    card: colors.card || LIGHT_PARTY.card,
    ink: colors.ink || LIGHT_PARTY.ink,
    inkSecondary: colors.inkSecondary || LIGHT_PARTY.inkSecondary,
    title: colors.title || LIGHT_PARTY.title,
    orange: colors.orange || LIGHT_PARTY.orange,
    purple: colors.purple || LIGHT_PARTY.purple,
    onAccent: colors.onAccent || LIGHT_PARTY.onAccent,
    border: colors.border || LIGHT_PARTY.border,
    danger: colors.danger || LIGHT_PARTY.danger,
  }
}

export function ProfileRequiredGate({ user, supabase }) {
  const segments = useSegments()
  const router = useRouter()
  const segment = segments[0] || ''

  useEffect(() => {
    let alive = true
    async function run() {
      if (!user?.id || !supabase) return
      let complete = false
      try {
        const profile = await loadOwnProfile(supabase, user.id)
        complete = isProfileComplete(profile)
      } catch {
        complete = false
      }
      if (!alive) return
      if (shouldRedirectToProfileSetup({ signedIn: true, complete, segment })) {
        router.replace('/profile-setup')
      } else if (shouldLeaveProfileSetup({ signedIn: true, complete, segment })) {
        router.replace('/')
      }
    }
    run()
    return () => {
      alive = false
    }
  }, [user?.id, supabase, segment, router])

  return null
}

function usePartyStyles(colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    card: {
      backgroundColor: colors.card,
      borderRadius: 20,
      padding: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      gap: 8,
    },
    kicker: { color: colors.orange, fontWeight: '800', letterSpacing: 1.1, fontSize: 11 },
    title: { color: colors.title, fontSize: 22, fontWeight: '800' },
    copy: { color: colors.inkSecondary, fontSize: 14, lineHeight: 20 },
    name: { color: colors.ink, fontSize: 18, fontWeight: '800' },
    rating: { color: colors.orange, fontWeight: '800' },
    label: { color: colors.inkSecondary, fontSize: 13, fontWeight: '700' },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      color: colors.ink,
      borderRadius: 14,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 16,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      borderRadius: 999,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    chipOn: { backgroundColor: colors.purple, borderColor: colors.purple },
    chipText: { color: colors.purple, fontWeight: '700' },
    chipTextOn: { color: colors.onAccent, fontWeight: '700' },
    primary: {
      backgroundColor: colors.orange,
      borderRadius: 16,
      paddingVertical: 14,
      alignItems: 'center',
    },
    ghost: {
      borderRadius: 16,
      paddingVertical: 14,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    primaryText: { color: colors.onAccent, fontWeight: '800', fontSize: 16 },
    ghostText: { color: colors.title, fontWeight: '800', fontSize: 16 },
    error: { color: colors.danger, fontSize: 13, lineHeight: 18 },
    star: { fontSize: 28, fontWeight: '800' },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    avatar: {
      width: 52,
      height: 52,
      borderRadius: 16,
      backgroundColor: colors.purple,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: colors.onAccent, fontWeight: '800', fontSize: 20 },
  })
}

export function RideStyleChips({ value, onChange, colors = LIGHT_PARTY }) {
  const styles = usePartyStyles(colors)
  return (
    <View style={styles.chips}>
      {RIDE_STYLES.map((style) => {
        const on = value === style
        return (
          <Pressable
            key={style}
            onPress={() => onChange(style)}
            style={[styles.chip, on && styles.chipOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <Text style={on ? styles.chipTextOn : styles.chipText}>{style}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

export function CounterpartCard({ person, colors = LIGHT_PARTY }) {
  const styles = usePartyStyles(colors)
  if (!person) return null
  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>{person.roleLabel.toUpperCase()}</Text>
      <View style={styles.row}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{person.initial}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{person.name}</Text>
          <Text style={styles.rating}>{person.ratingLine}</Text>
        </View>
      </View>
      {person.student ? <Text style={styles.copy}>Clemson student</Text> : null}
      {person.vehicle ? <Text style={styles.copy}>{person.vehicle}</Text> : null}
      {person.rideStyle ? <Text style={styles.copy}>Ride style · {person.rideStyle}</Text> : null}
      {person.bio ? <Text style={styles.copy}>{person.bio}</Text> : null}
      {person.spots.length ? <Text style={styles.copy}>Spots · {person.spots.join(', ')}</Text> : null}
      {person.phone ? <Text style={styles.copy}>Phone · {person.phone}</Text> : null}
    </View>
  )
}

export function ProfileSetupScreen({
  supabase,
  user,
  colors = LIGHT_PARTY,
  mark = 'CR',
  onDone,
  onSignOut,
}) {
  const styles = usePartyStyles(colors)
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [bio, setBio] = useState('')
  const [rideStyle, setRideStyle] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!supabase || !user?.id) return undefined
    let alive = true
    loadOwnProfile(supabase, user.id).then((profile) => {
      if (!alive || !profile) return
      setFullName(profile.full_name || user.user_metadata?.full_name || '')
      setPhone(profile.phone || '')
      setBio(profile.bio || '')
      const style = String(profile.ride_style || '').split('|').map((part) => part.trim()).find((part) => RIDE_STYLES.includes(part))
      if (style) setRideStyle(style)
    }).catch((err) => {
      if (alive) setError(err?.message || 'Could not load your profile')
    })
    return () => {
      alive = false
    }
  }, [supabase, user?.id])

  async function onSave() {
    setError(null)
    const draft = { full_name: fullName, phone, bio, ride_style: rideStyle }
    const problem = profileFieldError(draft)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    try {
      await saveOwnProfile(supabase, user.id, draft)
      onDone?.()
    } catch (err) {
      setError(err?.message || 'Could not save your profile')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={[styles.screen, { padding: 20, paddingTop: 56, gap: 12 }]}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{mark}</Text>
      </View>
      <Text style={styles.title}>Your ride profile</Text>
      <Text style={styles.copy}>
        Riders and drivers both need a profile before using Clemson RIDES. The other person sees it once a ride is accepted.
      </Text>
      {!user ? (
        <Text style={styles.copy}>Sign in to save your profile.</Text>
      ) : (
        <>
          <Text style={styles.label}>Full name</Text>
          <TextInput value={fullName} onChangeText={setFullName} style={styles.input} placeholder="Jordan Lee" placeholderTextColor="#8B939E" />
          <Text style={styles.label}>Mobile number</Text>
          <TextInput value={phone} onChangeText={setPhone} style={styles.input} keyboardType="phone-pad" placeholder="864-555-0100" placeholderTextColor="#8B939E" />
          <Text style={styles.label}>Short bio</Text>
          <TextInput
            value={bio}
            onChangeText={setBio}
            style={[styles.input, { minHeight: 80 }]}
            multiline
            placeholder="How you like to ride"
            placeholderTextColor="#8B939E"
          />
          <Text style={styles.label}>Ride style</Text>
          <RideStyleChips value={rideStyle} onChange={setRideStyle} colors={colors} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable onPress={onSave} disabled={busy} style={styles.primary} accessibilityRole="button">
            <Text style={styles.primaryText}>{busy ? 'Saving…' : 'Save profile'}</Text>
          </Pressable>
        </>
      )}
      <Pressable onPress={onSignOut} style={styles.ghost} accessibilityRole="button">
        <Text style={styles.ghostText}>Sign out</Text>
      </Pressable>
    </View>
  )
}

export function RateTripPanel({
  supabase,
  userId,
  tripId,
  colors = LIGHT_PARTY,
  onDone,
  onLater,
}) {
  const styles = usePartyStyles(colors)
  const [trip, setTrip] = useState(null)
  const [person, setPerson] = useState(null)
  const [stars, setStars] = useState(5)
  const [comment, setComment] = useState('')
  const [error, setError] = useState(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!supabase || !tripId || !userId) return undefined
    let alive = true
    ;(async () => {
      try {
        const row = await fetchTripForRating(supabase, tripId)
        if (!alive) return
        setTrip(row)
        if (!row) {
          setError('Trip not found')
          return
        }
        const rated = await hasRatedTrip(supabase, tripId, userId)
        if (!alive) return
        if (rated) {
          setDone(true)
          return
        }
        const view = await loadCounterpart(supabase, row, userId)
        if (alive) setPerson(view)
      } catch (err) {
        if (alive) setError(err?.message || 'Could not load this trip')
      }
    })()
    return () => {
      alive = false
    }
  }, [supabase, tripId, userId])

  async function onSubmit() {
    const blocked = ratingBlockReason(trip, userId)
    if (blocked) {
      setError(blocked)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await submitPartyRating(supabase, { tripId, raterId: userId, stars, comment })
      setDone(true)
    } catch (err) {
      setError(err?.message || 'Could not submit rating')
    } finally {
      setBusy(false)
    }
  }

  const noun = trip && userId === trip.rider_id ? 'driver' : 'rider'
  const line = person?.ratingLine || formatRatingLine(null, 0)

  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>RATE THIS RIDE</Text>
      <Text style={styles.title}>{done ? 'Rating saved' : `Rate your ${noun}`}</Text>
      {person ? <CounterpartCard person={person} colors={colors} /> : null}
      {done ? (
        <>
          <Text style={styles.copy}>
            {line === 'New · no ratings yet'
              ? 'Their profile average updates from every 1–5 star rating on completed trips.'
              : `Profile average was ${line}. It refreshes from both sides of every completed trip.`}
          </Text>
          <Pressable onPress={onDone} style={styles.primary} accessibilityRole="button">
            <Text style={styles.primaryText}>Done</Text>
          </Pressable>
        </>
      ) : (
        <>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {[1, 2, 3, 4, 5].map((value) => (
              <Pressable key={value} onPress={() => setStars(value)} accessibilityRole="button" accessibilityLabel={`${value} star`}>
                <Text style={[styles.star, { color: value <= stars ? colors.orange : colors.inkSecondary }]}>★</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={comment}
            onChangeText={setComment}
            style={styles.input}
            placeholder="Optional note"
            placeholderTextColor="#8B939E"
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable onPress={onSubmit} disabled={busy || !trip} style={styles.primary} accessibilityRole="button">
            <Text style={styles.primaryText}>{busy ? 'Saving…' : `Submit ${stars} star${stars === 1 ? '' : 's'}`}</Text>
          </Pressable>
          {onLater ? (
            <Pressable onPress={onLater} style={styles.ghost} accessibilityRole="button">
              <Text style={styles.ghostText}>Later</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  )
}

export async function loadRatingSummary(supabase, userId) {
  const [profile, pending] = await Promise.all([
    loadOwnProfile(supabase, userId),
    findPendingRating(supabase, userId),
  ])
  return {
    line: formatRatingLine(profile?.rating_avg, profile?.rating_count),
    pending,
  }
}
