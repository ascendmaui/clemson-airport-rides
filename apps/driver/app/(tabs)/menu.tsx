import { useRouter, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Primary, useCardShadow } from '@/components/chrome'
import { EmptyState, FadeIn, type MenuRow, RowGroup } from '@/components/day'
import { SectionLabel } from '@/components/shell'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { displayFirstName } from 'rides-native/authErrors'
import { loadVehicle, type VehicleRow } from 'rides-native/driverDesk'
import { knowledgeQuizStatus, knowledgeQuizStatusLabel, loadKnowledgeQuiz } from 'rides-native/driverKnowledgeQuiz'
import { loadRatingSummary } from 'rides-native/PartyScreens'

function vehicleSubtitle(vehicle: VehicleRow | null): string {
  if (!vehicle) return 'Add the car riders will see'
  const name = [vehicle.make, vehicle.model].filter(Boolean).join(' ')
  const plate = vehicle.plate ? ` · ${vehicle.plate}` : ''
  return `${name || 'Vehicle'}${plate}`
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'DR'
  const first = parts[0]?.[0] || ''
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] || '' : parts[0]?.[1] || ''
  return `${first}${last}`.toUpperCase()
}

export default function MenuScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { colors } = useTheme()
  const shadow = useCardShadow()
  const [vehicle, setVehicle] = useState<VehicleRow | null>(null)
  const [ratingLine, setRatingLine] = useState('New driver · no ratings yet')
  const [pendingTrip, setPendingTrip] = useState<string | null>(null)
  const [quizLabel, setQuizLabel] = useState('Not started')
  const name = user ? displayFirstName(user.user_metadata?.full_name || user.email?.split('@')[0], 'Driver') : 'Guest'

  const refresh = useCallback(async () => {
    if (!user || !supabase) return
    const [nextVehicle, summary, quiz] = await Promise.all([
      loadVehicle(supabase, user.id),
      loadRatingSummary(supabase, user.id).catch(() => null),
      loadKnowledgeQuiz(supabase, user.id).catch(() => null),
    ])
    setVehicle(nextVehicle)
    setQuizLabel(knowledgeQuizStatusLabel(knowledgeQuizStatus(quiz?.row)))
    if (summary) {
      setRatingLine(summary.line)
      setPendingTrip(summary.pending?.id || null)
    }
  }, [user])

  useFocusEffect(useCallback(() => {
    refresh().catch(() => setVehicle(null))
  }, [refresh]))

  const spotlight: MenuRow[] = []
  if (pendingTrip) {
    spotlight.push({
      key: 'rate',
      icon: 'star',
      title: 'Rate your last rider',
      subtitle: '1–5 stars after the trip is complete',
      onPress: () => router.push({ pathname: '/rate', params: { trip: pendingTrip } }),
    })
  }
  spotlight.push({
    key: 'refer',
    icon: 'gift',
    title: 'Refer friends',
    subtitle: 'Share Clemson RIDES',
    onPress: () => router.push('/refer'),
  })

  const manage: MenuRow[] = [
    { icon: 'person', title: 'Profile photo', subtitle: 'Submit a photo of yourself for review', onPress: () => router.push('/profile-photo') },
    { icon: 'car', title: 'Vehicles', subtitle: vehicleSubtitle(vehicle), onPress: () => router.push('/vehicles') },
    { icon: 'document-text', title: 'Documents', subtitle: 'License, insurance, registration', onPress: () => router.push('/documents') },
    { icon: 'shield-checkmark', title: 'Insurance', subtitle: 'Your policy and trip coverage notes', onPress: () => router.push('/insurance') },
  ]
  const money: MenuRow[] = [
    { icon: 'calculator', title: 'Tax info', subtitle: 'W-9 on your application', onPress: () => router.push('/tax') },
    { icon: 'card', title: 'Payout methods', subtitle: 'Stripe balance and cash out', onPress: () => router.push('/payouts') },
  ]
  const resources: MenuRow[] = [
    { icon: 'school', title: 'Learning Center', subtitle: quizLabel, onPress: () => router.push('/learning') },
    { icon: 'bug', title: 'Bug Reporter', subtitle: 'File a ticket for the driver app', onPress: () => router.push('/bug-report') },
    { icon: 'information-circle', title: 'About', subtitle: 'Version and what this app is', onPress: () => router.push('/about') },
  ]
  const account: MenuRow[] = [
    { icon: 'settings', title: 'Settings', subtitle: 'Display, navigation, and sounds', onPress: () => router.push('/settings') },
    { icon: 'swap-horizontal', title: 'Switch account', subtitle: 'One driver session on this phone', onPress: () => router.push('/switch-account') },
    { icon: 'car-sport', title: 'Tesla Model 3 listing', subtitle: 'Existing fleet toggle', onPress: () => router.push('/fleet') },
  ]

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + 12 }]}>
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        <FadeIn style={styles.stack}>
          <View style={styles.profile}>
            <View style={[styles.avatar, shadow, { backgroundColor: colors.fill }]}>
              <Text style={[styles.avatarText, { color: colors.onAccent }]}>{initials(name)}</Text>
            </View>
            <View style={styles.profileCopy}>
              <Text style={[styles.kicker, { color: colors.orange }]}>DRIVER</Text>
              <Text style={[styles.title, { color: colors.title }]}>{name}</Text>
            </View>
          </View>
          <Text style={{ color: colors.orange, fontWeight: '800' }}>
            {user ? ratingLine : 'Sign in to see your rating'}
          </Text>
          <Text style={{ color: colors.inkSecondary }}>
            {user?.email || 'Campus and airport rides for Clemson'}
          </Text>
          {!user ? (
            <EmptyState
              icon="log-in"
              title="Sign in to manage driving"
              body="Your rating, vehicle, documents, and payout balance stay on the driver account you sign in with."
              action={<Primary label="Sign in" onPress={() => router.push('/sign-in')} />}
            />
          ) : null}
          <RowGroup rows={spotlight} />
          <SectionLabel>Manage</SectionLabel>
          <RowGroup rows={manage} />
          <SectionLabel>Money</SectionLabel>
          <RowGroup rows={money} />
          <SectionLabel>Resources</SectionLabel>
          <RowGroup rows={resources} />
          <SectionLabel>Account</SectionLabel>
          <RowGroup rows={account} />
        </FadeIn>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { paddingHorizontal: 16, paddingBottom: 36 },
  stack: { gap: 8 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 4 },
  avatar: { width: 64, height: 64, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 22, fontWeight: '800', letterSpacing: 0.4 },
  profileCopy: { flex: 1, gap: 2 },
  kicker: { fontWeight: '800', letterSpacing: 1.1, fontSize: 12 },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.4 },
})
