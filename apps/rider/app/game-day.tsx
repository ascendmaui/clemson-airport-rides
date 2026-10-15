import { useRouter } from 'expo-router'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { GameDayBoard } from 'rides-native/GameDayBoard.jsx'
import { useGameDayExperience } from 'rides-native/useGameDayExperience.js'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'

export default function GameDayScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const { model, ready } = useGameDayExperience(supabase)

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: colors.orange }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: colors.purple, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ color: colors.onAccent, fontSize: 18, fontWeight: '700' }}>←</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.orangeInk, fontSize: 12, fontWeight: '800', letterSpacing: 1.2 }}>GAME DAY</Text>
          <Text style={{ color: colors.title, fontSize: 22, fontWeight: '800' }}>Stadium guide</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 32 }}>
        {ready ? <GameDayBoard model={model} audience="rider" /> : (
          <Text style={{ color: colors.inkSecondary }}>Checking the schedule…</Text>
        )}
      </ScrollView>
    </View>
  )
}
