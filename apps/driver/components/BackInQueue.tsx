import { useEffect, useState } from 'react'
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native'
import { backInQueueCopy } from 'rides-native/tripEndSummary'
import { setDriverOnline } from 'rides-native/drivers'
import { ErrorText, Primary } from '@/components/chrome'
import { useTheme } from '@/lib/theme'

type Client = Parameters<typeof setDriverOnline>[0]

/** Shown after the trip-end summary and rating: online drivers go straight back to offers. */
export function BackInQueue({
  supabase,
  driverId,
  onSeeOffers,
}: {
  supabase: Client
  driverId: string
  onSeeOffers: () => void
}) {
  const { colors } = useTheme()
  const [online, setOnline] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const client = supabase as { from: (table: string) => any } | null
    if (!client) return undefined
    Promise.resolve(client.from('driver_status').select('online').eq('driver_id', driverId).maybeSingle())
      .then((res: { data?: { online?: boolean } | null }) => {
        if (!alive) return
        const next = Boolean(res?.data?.online)
        setOnline(next)
        AccessibilityInfo.announceForAccessibility(next ? 'Back in queue. You are online.' : 'Trip done. You are offline.')
      })
      .catch(() => {
        if (alive) setOnline(false)
      })
    return () => {
      alive = false
    }
  }, [supabase, driverId])

  if (online == null) return null
  const copy = backInQueueCopy(online)

  async function goOffline() {
    setBusy(true)
    setError(null)
    try {
      await setDriverOnline(supabase, driverId, false)
      setOnline(false)
      AccessibilityInfo.announceForAccessibility('You are now offline')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not go offline')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View accessibilityRole="summary" style={[styles.box, { backgroundColor: colors.track }]}>
      <Text style={[styles.kicker, { color: online ? colors.orange : colors.inkSecondary }]}>{copy.kicker}</Text>
      <Text style={[styles.title, { color: colors.title }]} accessibilityRole="header">{copy.title}</Text>
      <Text style={[styles.body, { color: colors.inkSecondary }]}>{copy.body}</Text>
      {error ? <ErrorText>{error}</ErrorText> : null}
      <Primary label={copy.primary} onPress={onSeeOffers} tone={online ? 'orange' : 'purple'} />
      {online ? (
        <Primary label={busy ? 'Going offline…' : copy.secondary} onPress={goOffline} disabled={busy} tone="ghost" />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { borderRadius: 18, padding: 14, gap: 8 },
  kicker: { fontWeight: '800', letterSpacing: 1, fontSize: 12 },
  title: { fontSize: 24, fontWeight: '900' },
  body: { fontSize: 14, lineHeight: 20 },
})
