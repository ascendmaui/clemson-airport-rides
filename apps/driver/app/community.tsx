import { useRouter } from 'expo-router'
import { Card } from '@/components/chrome'
import { StackPage } from '@/components/shell'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { CommunityProfileEditor } from 'rides-native/CommunityProfileEditor'

export default function CommunityScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const { colors } = useTheme()
  return (
    <StackPage title="Campus community" onBack={() => router.back()}>
      <Card>
        {user?.id ? <CommunityProfileEditor supabase={supabase} userId={user.id} colors={colors} /> : null}
      </Card>
    </StackPage>
  )
}
