import { useEffect, useState } from 'react'
import { Alert, Text } from 'react-native'
import { Card, Primary } from '@/components/chrome'
import { useTheme } from '@/lib/theme'
import { formatCents } from 'rides-native/tripTags'
import { waitTimerView, type WaitAnchor } from 'rides-native/waitTimer'

export function WaitTimer({ arrivedAt, anchor, busy, onCancel }: {
  arrivedAt: string | null; anchor: WaitAnchor | null; busy: boolean; onCancel: () => void
}) {
  const { colors } = useTheme()
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const view = waitTimerView(arrivedAt, now, anchor)
  function confirmCancel() {
    const current = waitTimerView(arrivedAt, Date.now(), anchor)
    if (!current.cancelAvailable || busy) return
    Alert.alert('Rider no-show', `The rider will be charged ${formatCents(current.riderChargeCents)}. You earn ${formatCents(current.driverEarningsCents)}.`, [
      { text: 'Keep waiting', style: 'cancel' },
      { text: 'Cancel ride', style: 'destructive', onPress: onCancel },
    ])
  }
  return (
    <Card>
      <Text accessible accessibilityLabel={view.accessibilityLabel} style={{ color: colors.title, fontWeight: '800', fontSize: 28 }}>
        {view.clock} · {view.feeLabel}
      </Text>
      <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
        3:00 free, then $1 per started minute, capped at $4. Cancel from 5:00 for accrued wait only. At 7:00: auto-cancel, rider pays $5, you earn $4.
      </Text>
      <Primary label={view.buttonLabel} accessibilityLabel={view.buttonLabel}
        onPress={confirmCancel} disabled={busy || !view.cancelAvailable} tone="ghost" />
    </Card>
  )
}
