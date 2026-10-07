import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Card, ErrorText, Primary } from '@/components/chrome'
import { EmptyState, FadeIn } from '@/components/day'
import { StackPage, Toggle } from '@/components/shell'
import { oneParam } from '@/lib/oneParam'
import { useAuth } from '@/lib/auth'
import { registerDriverPush, type PushState } from '@/lib/push'
import { supabase } from '@/lib/supabase'
import { useTheme, type DisplayMode, type NavApp, type RideAlertMode, type RideAlertTier } from '@/lib/theme'
import { loadDriverProfile } from 'rides-native/driverDesk'

const SECTIONS = ['display', 'privacy', 'address', 'accessibility', 'communication', 'navigation', 'sounds', 'auto-accept'] as const
type Section = (typeof SECTIONS)[number]

function isSection(value: string): value is Section {
  return (SECTIONS as readonly string[]).includes(value)
}

function sectionTitle(section: Section): string {
  switch (section) {
    case 'display':
      return 'Display'
    case 'privacy':
      return 'Privacy'
    case 'address':
      return 'Address'
    case 'accessibility':
      return 'Accessibility'
    case 'communication':
      return 'Communication'
    case 'navigation':
      return 'Navigation'
    case 'sounds':
      return 'Sounds and voice'
    case 'auto-accept':
      return 'Auto-accept'
    default: {
      const unknown: never = section
      return unknown
    }
  }
}

const DISPLAY_OPTIONS: { id: DisplayMode; label: string; body: string }[] = [
  { id: 'auto', label: 'Auto (solar)', body: 'Light after sunrise and dark after sunset for your last known location, or Clemson, SC.' },
  { id: 'light', label: 'Light', body: 'The current Clemson cream, orange, and purple look.' },
  { id: 'dark', label: 'Dark', body: 'Same orange and purple on the night field (#0E0B14).' },
]

export default function SettingsSection() {
  const router = useRouter()
  const params = useLocalSearchParams<{ section?: string }>()
  const raw = oneParam(params.section)
  const section: Section = isSection(raw) ? raw : 'display'
  const { user } = useAuth()
  const theme = useTheme()
  const { colors } = theme
  const [phone, setPhone] = useState<string | null>(null)
  const [push, setPush] = useState<PushState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!user || !supabase || section !== 'address') return
    loadDriverProfile(supabase, user.id).then((profile) => {
      const value = profile && typeof profile.phone === 'string' ? profile.phone : null
      setPhone(value)
    }).catch((err) => setError(err instanceof Error ? err.message : 'Could not load your profile'))
  }, [section, user])

  useEffect(() => {
    if (!user || section !== 'communication') return
    registerDriverPush(supabase, user.id).then(setPush).catch((err) => {
      setError(err instanceof Error ? err.message : 'Could not check notifications')
    })
  }, [section, user])

  return (
    <StackPage title={sectionTitle(section)} onBack={() => router.back()}>
      <FadeIn style={{ gap: 12 }}>
        {section === 'display' ? (
          <>
            <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
              Auto follows the sun. It does not follow the phone’s system appearance. Place used now: {theme.solarPlace}.
            </Text>
            <ChoiceCards
              options={DISPLAY_OPTIONS}
              value={theme.displayMode}
              onChange={theme.setDisplayMode}
            />
          </>
        ) : null}
        {section === 'privacy' ? (
          <Card>
            <View style={styles.row}>
              <Text style={{ color: colors.ink, fontWeight: '800', flex: 1 }}>Make earnings private</Text>
              <Toggle on={theme.earningsPrivate} onPress={() => theme.setEarningsPrivate(!theme.earningsPrivate)} label="Make earnings private" />
            </View>
            <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
              Hides dollar amounts on this phone. Your live pin is still shared with riders while you are online.
            </Text>
          </Card>
        ) : null}
        {section === 'address' ? (
          <EmptyState
            icon="home"
            title="Home address"
            body={`Saving a home address is not available yet. Your profile phone ${phone ? `is ${phone}` : 'is not on file'}. Update the driver application if that number should change.`}
            action={<Primary label="Open driver application" onPress={() => router.push('/onboarding')} tone="ghost" />}
          />
        ) : null}
        {section === 'accessibility' ? (
          <EmptyState
            icon="accessibility"
            title="Text size"
            body="Labels follow the phone’s text size. A separate high-contrast theme is not in this build. Orange and purple stay the Clemson colors in light and dark."
          />
        ) : null}
        {section === 'communication' ? (
          <Card>
            <Text style={{ color: colors.title, fontWeight: '800', fontSize: 17 }}>Trip alerts</Text>
            <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
              {push?.detail || 'Checking notification permission…'}
            </Text>
            <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
              While you are online with the app open, a new request plays in the app with sound and vibration. Asleep, locked, or signed out, the same request is a system notification. That lock-screen path needs an Expo access token on the server plus APNs for iPhone and FCM for Android on the Expo project. Those keys are not in the app, so a saved push token does not by itself prove a locked phone will toast.
            </Text>
          </Card>
        ) : null}
        {section === 'navigation' ? <NavChoices /> : null}
        {section === 'sounds' ? <SoundChoices /> : null}
        {section === 'auto-accept' ? <AutoAcceptChoices /> : null}
        {error ? <ErrorText>{error}</ErrorText> : null}
      </FadeIn>
    </StackPage>
  )
}

function ChoiceCards<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string; body?: string }[]
  value: T
  onChange: (id: T) => void
}) {
  const { colors } = useTheme()
  return (
    <>
      {options.map((option) => {
        const on = option.id === value
        return (
          <Pressable
            key={option.id}
            onPress={() => onChange(option.id)}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: on }}
          >
            <Card style={{ borderColor: on ? colors.orange : colors.border, borderWidth: on ? 1.5 : StyleSheet.hairlineWidth }}>
              <View style={styles.choice}>
                <Text style={{ color: on ? colors.orange : colors.title, fontWeight: '800', fontSize: 16, flex: 1 }}>{option.label}</Text>
                {on ? <Ionicons name="checkmark-circle" size={22} color={colors.orange} /> : null}
              </View>
              {option.body ? <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>{option.body}</Text> : null}
            </Card>
          </Pressable>
        )
      })}
    </>
  )
}

const ALERT_MODES: { id: RideAlertMode; label: string; body: string }[] = [
  { id: 'chime_vibrate', label: 'Chime and vibrate', body: 'Sound plus vibration.' },
  { id: 'chime', label: 'Chime only', body: 'Sound, no vibration.' },
  { id: 'vibrate', label: 'Vibrate only', body: 'A pulse, no sound.' },
  { id: 'silent', label: 'Silent', body: 'The card still appears.' },
]

const ALERT_TIERS: { id: RideAlertTier; label: string }[] = [
  { id: 'standard', label: 'Standard' },
  { id: 'wait', label: 'Wait & Save' },
  { id: 'comfort', label: 'Extra Comfort' },
  { id: 'carpool', label: 'Carpool' },
]

function usePersistDriverAlerts() {
  const { user } = useAuth()
  const { rideAlerts, autoAccept } = useTheme()
  useEffect(() => {
    if (!user || !supabase) return undefined
    let cancel = false
    supabase.from('profiles').select('notification_prefs').eq('id', user.id).maybeSingle().then((res: { data?: { notification_prefs?: object } | null; error?: { message?: string } | null }) => {
      if (cancel || res.error) return null
      const next = { ...(res.data?.notification_prefs || {}), ride_alerts: rideAlerts, auto_accept: autoAccept }
      return supabase.from('profiles').update({ notification_prefs: next }).eq('id', user.id)
    }).catch(() => null)
    return () => {
      cancel = true
    }
  }, [autoAccept, rideAlerts, user])
}

function SoundChoices() {
  const theme = useTheme()
  const { colors } = theme
  usePersistDriverAlerts()
  return (
    <>
      <Card>
        <View style={styles.row}>
          <Text style={{ color: colors.ink, fontWeight: '800', flex: 1 }}>Request chime</Text>
          <Toggle on={theme.sounds} onPress={() => theme.setSounds(!theme.sounds)} label="Request chime" />
        </View>
        <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
          Turn the chime off to mute every ride type. Vibration still follows the choice below. The phone’s silent switch mutes the chime.
        </Text>
      </Card>
      {ALERT_TIERS.map((tier) => (
        <View key={tier.id} style={{ gap: 8 }}>
          <Text style={{ color: colors.purple, fontWeight: '800' }}>{tier.label}</Text>
          <ChoiceCards
            options={ALERT_MODES}
            value={theme.rideAlerts[tier.id]}
            onChange={(mode) => theme.setRideAlert(tier.id, mode)}
          />
        </View>
      ))}
    </>
  )
}

const MILE_CHOICES = [1, 2, 3, 5, 10]
const HOURLY_CHOICES = [15, 20, 25, 30, 40]

function AutoAcceptChoices() {
  const theme = useTheme()
  const { colors, autoAccept, setAutoAccept } = theme
  usePersistDriverAlerts()
  return (
    <>
      <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
        Online requests that match these rules are accepted for you. Favorite riders match even when the other bars are not met. Distance and hourly rate both have to pass when both are on.
      </Text>
      <Card>
        <View style={styles.row}>
          <Text style={{ color: colors.ink, fontWeight: '800', flex: 1 }}>Within distance</Text>
          <Toggle on={autoAccept.distanceEnabled} onPress={() => setAutoAccept({ distanceEnabled: !autoAccept.distanceEnabled })} label="Auto-accept by distance" />
        </View>
        <View style={styles.chips}>
          {MILE_CHOICES.map((miles) => {
            const on = autoAccept.maxPickupMiles === miles
            return (
              <Pressable
                key={miles}
                onPress={() => setAutoAccept({ maxPickupMiles: miles })}
                accessibilityRole="button"
                accessibilityLabel={`Auto-accept within ${miles} miles`}
                accessibilityState={{ selected: on }}
                style={[styles.chip, { backgroundColor: on ? colors.orange : colors.segment }]}
              >
                <Text style={{ color: on ? '#fff' : colors.title, fontWeight: '800' }}>{miles} mi</Text>
              </Pressable>
            )
          })}
        </View>
      </Card>
      <Card>
        <View style={styles.row}>
          <Text style={{ color: colors.ink, fontWeight: '800', flex: 1 }}>Hourly rate</Text>
          <Toggle on={autoAccept.hourlyEnabled} onPress={() => setAutoAccept({ hourlyEnabled: !autoAccept.hourlyEnabled })} label="Auto-accept by hourly rate" />
        </View>
        <View style={styles.chips}>
          {HOURLY_CHOICES.map((dollars) => {
            const on = autoAccept.minHourlyCents === dollars * 100
            return (
              <Pressable
                key={dollars}
                onPress={() => setAutoAccept({ minHourlyCents: dollars * 100 })}
                accessibilityRole="button"
                accessibilityLabel={`Auto-accept at ${dollars} dollars per hour or more`}
                accessibilityState={{ selected: on }}
                style={[styles.chip, { backgroundColor: on ? colors.purple : colors.segment }]}
              >
                <Text style={{ color: on ? '#fff' : colors.title, fontWeight: '800' }}>${dollars}/hr</Text>
              </Pressable>
            )
          })}
        </View>
      </Card>
      <Card>
        <View style={styles.row}>
          <Text style={{ color: colors.ink, fontWeight: '800', flex: 1 }}>Favorite riders</Text>
          <Toggle on={autoAccept.favoritesEnabled} onPress={() => setAutoAccept({ favoritesEnabled: !autoAccept.favoritesEnabled })} label="Auto-accept favorite riders" />
        </View>
        <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
          Save a rider from their request card. Those riders are accepted as soon as the offer arrives.
        </Text>
        {autoAccept.favoriteRiders.length === 0 ? (
          <Text style={{ color: colors.ink, fontWeight: '700' }}>No favorite riders yet.</Text>
        ) : autoAccept.favoriteRiders.map((rider) => (
          <View key={rider.id} style={styles.row}>
            <Text style={{ color: colors.title, fontWeight: '800', flex: 1 }}>{rider.name}</Text>
            <Pressable
              onPress={() => setAutoAccept({ favoriteRiders: autoAccept.favoriteRiders.filter((row) => row.id !== rider.id) })}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${rider.name} from favorites`}
            >
              <Text style={{ color: colors.orange, fontWeight: '800' }}>Remove</Text>
            </Pressable>
          </View>
        ))}
      </Card>
    </>
  )
}

function NavChoices() {
  const { colors, navApp, setNavApp } = useTheme()
  const options: { id: NavApp; label: string }[] = [
    { id: 'apple', label: 'Apple Maps' },
    { id: 'google', label: 'Google Maps' },
  ]
  return (
    <>
      <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
        The live trip screen opens this app first. This does not add a maps key or turn-by-turn inside Clemson RIDES.
      </Text>
      <ChoiceCards options={options} value={navApp} onChange={setNavApp} />
    </>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
})
