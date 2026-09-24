import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Card, ErrorText, Primary } from '@/components/chrome'
import { StackPage, Toggle } from '@/components/shell'
import { oneParam } from '@/lib/oneParam'
import { useAuth } from '@/lib/auth'
import { registerDriverPush, type PushState } from '@/lib/push'
import { supabase } from '@/lib/supabase'
import { useTheme, type DisplayMode, type NavApp } from '@/lib/theme'
import { loadDriverProfile } from 'rides-native/driverDesk'

const SECTIONS = ['display', 'privacy', 'address', 'accessibility', 'communication', 'navigation', 'sounds'] as const
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
      {section === 'display' ? (
        <>
          <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
            Auto follows the sun. It does not follow the phone’s system appearance. Place used now: {theme.solarPlace}.
          </Text>
          {DISPLAY_OPTIONS.map((option) => {
            const on = theme.displayMode === option.id
            return (
              <Pressable key={option.id} onPress={() => theme.setDisplayMode(option.id)}>
                <Card>
                  <Text style={{ color: on ? colors.orange : colors.title, fontWeight: '800' }}>{option.label}</Text>
                  <Text style={{ color: colors.inkSecondary }}>{option.body}</Text>
                </Card>
              </Pressable>
            )
          })}
        </>
      ) : null}
      {section === 'privacy' ? (
        <Card>
          <View style={styles.row}>
            <Text style={{ color: colors.ink, fontWeight: '800', flex: 1 }}>Make earnings private</Text>
            <Toggle on={theme.earningsPrivate} onPress={() => theme.setEarningsPrivate(!theme.earningsPrivate)} label="Make earnings private" />
          </View>
          <Text style={{ color: colors.inkSecondary }}>
            Hides dollar amounts on this phone. Your live pin is still shared with riders while you are online.
          </Text>
        </Card>
      ) : null}
      {section === 'address' ? (
        <Card>
          <Text style={{ color: colors.title, fontWeight: '800' }}>Home address</Text>
          <Text style={{ color: colors.inkSecondary }}>
            Saving a home address is not available yet. Your profile phone {phone ? `is ${phone}` : 'is not on file'}.
          </Text>
          <Primary label="Open driver application" onPress={() => router.push('/onboarding')} tone="ghost" />
        </Card>
      ) : null}
      {section === 'accessibility' ? (
        <Card>
          <Text style={{ color: colors.title, fontWeight: '800' }}>Text size</Text>
          <Text style={{ color: colors.inkSecondary }}>
            Labels follow the phone’s text size. A separate contrast theme is not in this build.
          </Text>
        </Card>
      ) : null}
      {section === 'communication' ? (
        <Card>
          <Text style={{ color: colors.title, fontWeight: '800' }}>Trip alerts</Text>
          <Text style={{ color: colors.inkSecondary }}>{push?.detail || 'Checking notification permission…'}</Text>
        </Card>
      ) : null}
      {section === 'navigation' ? <NavChoices /> : null}
      {section === 'sounds' ? (
        <Card>
          <View style={styles.row}>
            <Text style={{ color: colors.ink, fontWeight: '800', flex: 1 }}>Request chime</Text>
            <Toggle on={theme.sounds} onPress={() => theme.setSounds(!theme.sounds)} label="Request chime" />
          </View>
          <Text style={{ color: colors.inkSecondary }}>
            The chime stays silent when the phone is on silent. Haptics still fire for new requests.
          </Text>
        </Card>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </StackPage>
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
      <Text style={{ color: colors.inkSecondary }}>The live trip screen opens this app first.</Text>
      {options.map((option) => {
        const on = navApp === option.id
        return (
          <Pressable key={option.id} onPress={() => setNavApp(option.id)}>
            <Card>
              <Text style={{ color: on ? colors.orange : colors.title, fontWeight: '800' }}>{option.label}</Text>
            </Card>
          </Pressable>
        )
      })}
    </>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
})
