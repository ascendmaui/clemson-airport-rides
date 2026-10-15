import { useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AdminInboxScreen } from 'rides-native/AdminInboxScreen.jsx'
import { PayoutApprovalsPanel } from 'rides-native/PayoutApprovalsPanel.jsx'
import { PromoAdminPanel } from 'rides-native/PromoAdminPanel.jsx'
import { WEB_ADMIN_URL } from 'rides-native/adminInboxClient.js'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'

export default function DriverAdminScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: colors.background }}>
      {/* Driver app only (never the rider app). Hidden unless the server says this is the payout approver. */}
      <PayoutApprovalsPanel supabase={supabase} colors={colors} />
      {/* Promo codes: same rule, hidden unless the server says this is the promo admin. */}
      <PromoAdminPanel supabase={supabase} colors={colors} />
      <AdminInboxScreen
        supabase={supabase}
        colors={colors}
        onBack={() => router.back()}
        onOpenWeb={(url) => { void WebBrowser.openBrowserAsync(url || WEB_ADMIN_URL) }}
      />
    </View>
  )
}
