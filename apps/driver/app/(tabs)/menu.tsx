import { Glyph } from 'rides-native/icons'
import { useRouter, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { supportEmail, supportMailto } from '../../../../shared/productLinks.js'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Primary, useCardShadow } from '@/components/chrome'
import { EmptyState, FadeIn, type MenuRow, RowGroup } from '@/components/day'
import { SectionLabel } from '@/components/shell'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { radius, type as typeScale } from 'rides-native/shared/theme.js'
import { displayFirstName } from 'rides-native/authErrors'
import { loadDriverPerks, loadVehicle, setLeaderboardOptOut, type Leaderboard, type VehicleRow } from 'rides-native/driverDesk'
import { knowledgeQuizStatus, knowledgeQuizStatusLabel, loadKnowledgeQuiz } from 'rides-native/driverKnowledgeQuiz'
import { loadRatingSummary } from 'rides-native/PartyScreens'
import { AdminAccountRow } from 'rides-native/AdminAccountRow.jsx'
import { quietly } from '@/lib/softFail'
import { offerSheetBottomInset } from 'rides-native/offerStack.js'

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
  const [onLeaderboard, setOnLeaderboard] = useState<boolean | null>(null)
  const name = user ? displayFirstName(user.user_metadata?.full_name || user.email?.split('@')[0], 'Driver') : 'Guest'

  const refresh = useCallback(async () => {
    if (!user || !supabase) return
    const [nextVehicle, summary, quiz] = await Promise.all([
      loadVehicle(supabase, user.id),
      loadRatingSummary(supabase, user.id).catch(quietly('menu rating', null)),
      loadKnowledgeQuiz(supabase, user.id).catch(quietly('menu quiz', null)),
    ])
    setVehicle(nextVehicle)
    loadDriverPerks(supabase).then((p) => {
      const lb = p.leaderboard as Leaderboard | undefined
      setOnLeaderboard(lb?.enabled ? !lb.optedOut : null)
    }).catch(() => setOnLeaderboard(null))
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
    subtitle: 'Your code and referral bonus',
    onPress: () => router.push('/refer'),
  })

  const manage: MenuRow[] = [
    { icon: 'person', title: 'Profile photo', subtitle: 'Submit a photo of yourself for review', onPress: () => router.push('/profile-photo') },
    { icon: 'car', title: 'Vehicles', subtitle: vehicleSubtitle(vehicle), onPress: () => router.push('/vehicles') },
    { icon: 'document-text', title: 'Documents', subtitle: 'License, insurance, registration', onPress: () => router.push('/documents') },
    { icon: 'shield-checkmark', title: 'Insurance', subtitle: 'Your policy and trip coverage notes', onPress: () => router.push('/insurance') },
    { icon: 'shield', title: 'Safety', subtitle: 'Audio, video, live location, and SOS', onPress: () => router.push('/safety') },
    { icon: 'ribbon', title: 'Scorecard', subtitle: 'Acceptance, completion, rating, and map markers', onPress: () => router.push('/scorecard') },
    { icon: 'speedometer', title: 'Safety score', subtitle: 'Estimate and tips', onPress: () => router.push('/safety-score') },
  ]
  const inbox: MenuRow[] = [
    { icon: 'inbox', title: 'Inbox', subtitle: 'Messages from Clemson Rides and riders', onPress: () => router.push('/inbox') },
    { icon: 'discover', title: 'Discover', subtitle: 'Busy spots, game days, and boosts', onPress: () => router.push('/discover') },
  ]
  const money: MenuRow[] = [
    { icon: 'calculator', title: 'Tax info', subtitle: 'Year-end mileage and earnings', onPress: () => router.push('/tax') },
  ]
  const supportRows: MenuRow[] = [
    { icon: 'help', title: 'Help', subtitle: supportEmail(), onPress: () => { void Linking.openURL(supportMailto('Clemson Rides help')) } },
    { icon: 'chat', title: 'Support', subtitle: supportEmail(), onPress: () => { void Linking.openURL(supportMailto('Clemson Rides support')) } },
  ]
  const resources: MenuRow[] = [
    { icon: 'school', title: 'Learning Center', subtitle: quizLabel, onPress: () => router.push('/learning') },
    { icon: 'bug', title: 'Bug Reporter', subtitle: 'File a ticket for the driver app', onPress: () => router.push('/bug-report') },
    { icon: 'information-circle', title: 'About', subtitle: 'Version and what this app is', onPress: () => router.push('/about') },
  ]
  const account: MenuRow[] = [
    { icon: 'settings', title: 'Settings', subtitle: 'Display, navigation, and sounds', onPress: () => router.push('/settings') },
    { icon: 'swap-horizontal', title: 'Switch account', subtitle: 'One driver session on this phone', onPress: () => router.push('/switch-account') },
  ]

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + 12 }]}>
      <ScrollView contentContainerStyle={[styles.list, { paddingBottom: offerSheetBottomInset(insets.bottom) + 24 }]} showsVerticalScrollIndicator={false}>
        <FadeIn style={styles.stack}>
          <View style={styles.profile}>
            <View style={[styles.avatar, shadow, { backgroundColor: colors.fill }]}>
              <Text style={[styles.avatarText, { color: colors.onAccent }]}>{initials(name)}</Text>
            </View>
            <View style={styles.profileCopy}>
              <Text style={[styles.kicker, { color: colors.orange }]}>ACCOUNT</Text>
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
          <SectionLabel>Inbox</SectionLabel>
          <RowGroup rows={inbox} />
          <SectionLabel>Vehicle and documents</SectionLabel>
          <RowGroup rows={manage} />
          <SectionLabel>Tax</SectionLabel>
          <RowGroup rows={money} />
          <SectionLabel>Help and support</SectionLabel>
          <RowGroup rows={supportRows} />
          <SectionLabel>Resources</SectionLabel>
          <RowGroup rows={resources} />
          <SectionLabel>Settings</SectionLabel>
          <RowGroup rows={account} />
          <AdminAccountRow supabase={supabase} colors={colors} onPress={() => router.push('/admin')} />
          {user && onLeaderboard != null ? (
            <View style={[styles.toggleRow, { backgroundColor: colors.card }]}>
              <View style={styles.deleteCopy}>
                <Text style={[styles.deleteTitle, { color: colors.title }]}>Show me on the weekly leaderboard</Text>
                <Text style={{ color: colors.inkSecondary }}>First name and last initial only</Text>
              </View>
              <Switch
                value={onLeaderboard}
                accessibilityLabel="Show me on the weekly leaderboard"
                onValueChange={(next) => {
                  setOnLeaderboard(next)
                  if (supabase) setLeaderboardOptOut(supabase, !next).catch(() => setOnLeaderboard(!next))
                }}
              />
            </View>
          ) : null}
          {user ? (
          <Pressable
            onPress={() => router.push('/delete-account')}
            accessibilityRole="button"
            accessibilityLabel="Delete account"
            accessibilityHint="Opens the account deletion screen. Deletion is immediate."
            style={[styles.deleteRow, { backgroundColor: colors.card, borderColor: colors.danger }]}
          >
            <Glyph name="trash-outline" size={20} color={colors.danger} />
            <View style={styles.deleteCopy}>
              <Text style={[styles.deleteTitle, { color: colors.danger }]}>Delete account</Text>
              <Text style={{ color: colors.inkSecondary }}>Deletes this account immediately</Text>
            </View>
          </Pressable>
          ) : null}
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
  kicker: { ...typeScale.kicker },
  title: { ...typeScale.title },
  deleteRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: radius.lg, padding: 16, marginTop: 8, minHeight: 60 },
  deleteCopy: { flex: 1, gap: 2 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radius.lg, padding: 16, minHeight: 60 },
  deleteTitle: { fontWeight: '800', fontSize: 16 },
})
