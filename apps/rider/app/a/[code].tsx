import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { clearAmbassadorCode, saveAmbassadorCode } from '@/lib/ambassadorCode'
import { setAuthNext } from '@/lib/authNext'
import { useAuth } from '@/lib/auth'
import { oneParam } from '@/lib/oneParam'
import { supabase } from '@/lib/supabase'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'
import { normalizeAmbassadorCode } from 'rides-native/shared/ambassadorAttribution.js'
import { apiErrorMessage, claimAmbassadorAttribution } from 'rides-native/shared/carpoolApi.js'

type ClaimError = Error & { status?: number; payload?: { code?: string } }

export default function AmbassadorLinkScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ code?: string }>()
  const code = normalizeAmbassadorCode(oneParam(params.code))
  const { user } = useAuth()
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!code) return undefined
    let alive = true
    saveAmbassadorCode(code, user?.id || null)
      .then(async () => {
        if (!alive) return
        setSaved(true)
        if (!user?.id) return
        try {
          const data = await claimAmbassadorAttribution(supabase, code)
          if (!alive) return
          if (data?.code) await saveAmbassadorCode(data.code, user.id)
          setError(null)
        } catch (err) {
          if (!alive) return
          const claim = err as ClaimError
          if (claim.status === 404 || claim.status === 409 || claim.payload?.code === 'own_link') {
            await clearAmbassadorCode()
            setSaved(false)
          }
          setError(apiErrorMessage(err))
        }
      })
      .catch((err: unknown) => {
        if (alive) setError(apiErrorMessage(err))
      })
    return () => {
      alive = false
    }
  }, [code, user?.id])

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 16 }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.kicker, { color: colors.orange }]}>CAMPUS AMBASSADOR</Text>
        <Text style={styles.title}>Referred by a campus ambassador</Text>
        <Text style={styles.body}>
          This link attributes the carpool you book. It is not a discount, and your fare does not change.
        </Text>
        {code && saved ? (
          <Text style={styles.saved}>
            {user ? 'Saved on your account.' : 'Saved on this device. Sign in so the next carpool keeps it.'}
          </Text>
        ) : null}
        {!code ? <Text style={styles.saved}>This ambassador link is not valid.</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!user && code ? (
          <PrimaryButton
            label="Sign in to keep this link"
            onPress={() => {
              setAuthNext(`/a/${code}`)
              router.push('/sign-in')
            }}
          />
        ) : null}
        <View style={{ height: 12 }} />
        <PrimaryButton label="Book a carpool" onPress={() => router.replace('/friends')} tone="outline" />
      </ScrollView>
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    screen: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: 24, paddingBottom: 32 },
    kicker: { fontSize: 12, fontWeight: '800' as const, letterSpacing: 1.2 },
    title: { marginTop: 8, fontSize: 28, fontWeight: '800' as const, color: colors.title, letterSpacing: -0.4 },
    body: { marginTop: 12, color: colors.inkSecondary, fontSize: 16, lineHeight: 22 },
    saved: { marginTop: 16, color: colors.title, fontWeight: '700' as const, fontSize: 16 },
    error: { marginTop: 12, color: colors.danger, fontSize: 14 },
  }
}
