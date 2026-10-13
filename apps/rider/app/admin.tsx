import { useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AdminInboxScreen } from 'rides-native/AdminInboxScreen.jsx'
import { WEB_ADMIN_URL } from 'rides-native/adminInboxClient.js'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'

export default function RiderAdminScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: colors.background }}>
      <AdminInboxScreen
        supabase={supabase}
        colors={colors}
        onBack={() => router.back()}
        onOpenWeb={(url) => { void WebBrowser.openBrowserAsync(url || WEB_ADMIN_URL) }}
      />
    </View>
  )
}
