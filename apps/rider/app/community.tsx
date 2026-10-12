import { useRouter } from 'expo-router'
import { ScrollView, Text } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { StackHeader } from '@/components/StackHeader'
import { RequireAuth } from '@/components/RequireAuth'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { CommunityProfileEditor } from 'rides-native/CommunityProfileEditor'

function CommunityScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { colors } = useTheme()
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 40, gap: 12 }}>
      <StackHeader title="Campus community" onBack={() => router.back()} />
      <Text style={{ color: colors.title, fontSize: 22, fontWeight: '800' }}>Find what you have in common</Text>
      {user?.id ? <CommunityProfileEditor supabase={supabase} userId={user.id} colors={colors} /> : null}
    </ScrollView>
  )
}

export default function CommunityRoute() {
  return (
    <RequireAuth>
      <CommunityScreen />
    </RequireAuth>
  )
}
