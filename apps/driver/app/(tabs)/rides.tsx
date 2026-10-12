import { useRouter } from 'expo-router'
import { ScrollView, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Primary } from '@/components/chrome'
import { DayHeader, EmptyState, FadeIn, type MenuRow, RowGroup } from '@/components/day'
import { SectionLabel } from '@/components/shell'
import { useAuth } from '@/lib/auth'
import { useTheme } from '@/lib/theme'

/** Rides tab: scheduled pickups up top, trip history below. */
export default function RidesTab() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { colors } = useTheme()
  const upcoming: MenuRow[] = [
    { icon: 'schedule', title: 'Scheduled pickups', subtitle: 'Airport and campus rides you can claim or have claimed', onPress: () => router.push('/queue') },
    { icon: 'clock', title: 'Driving time', subtitle: 'Hours online and rest breaks', onPress: () => router.push('/driving-time') },
  ]
  const past: MenuRow[] = [
    { icon: 'history', title: 'Trip history', subtitle: 'Every completed and canceled trip with its fare', onPress: () => router.push('/earnings-activity') },
  ]
  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + 12 }]}>
      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        <FadeIn style={{ gap: 12 }}>
          <DayHeader kicker="RIDES" title="Your trips" />
          {!user ? (
            <EmptyState
              icon="rides"
              title="Sign in to see your trips"
              body="Scheduled pickups and past trips appear on the driver account you sign in with."
              action={<Primary label="Sign in" onPress={() => router.push('/sign-in')} />}
            />
          ) : null}
          <SectionLabel>Upcoming</SectionLabel>
          <RowGroup rows={upcoming} />
          <SectionLabel>History</SectionLabel>
          <RowGroup rows={past} />
        </FadeIn>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { padding: 16, paddingBottom: 120 },
})
