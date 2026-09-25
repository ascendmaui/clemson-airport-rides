import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { PrimaryButton } from '@/components/Button'
import type { Palette } from '@/lib/palette'
import { useThemedStyles } from '@/lib/useThemedStyles'
import {
  HOLD_COUNTDOWN_TICK_MS,
  REQUEST_AGAIN_LABEL,
  holdExpiryPresentation,
} from 'rides-native/holdExpiryNotice.js'

export function HoldExpiryNotice({
  trip,
  onRequestAgain,
}: {
  trip: object | null
  onRequestAgain: () => void
}) {
  const [now, setNow] = useState(() => Date.now())
  const styles = useThemedStyles(makeStyles)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), HOLD_COUNTDOWN_TICK_MS)
    return () => clearInterval(id)
  }, [])

  const view = holdExpiryPresentation(trip, now)
  if (view.mode === 'hidden') return null

  return (
    <View style={[styles.card, view.mode === 'expired' ? styles.expired : null]}>
      <Text style={styles.kicker}>{view.mode === 'expired' ? 'HOLD EXPIRED' : 'AIRPORT DEPOSIT'}</Text>
      <Text
        accessibilityLiveRegion="polite"
        accessibilityLabel={view.label}
        style={styles.copy}
      >
        {view.label}
      </Text>
      {view.requestAgain ? (
        <PrimaryButton label={REQUEST_AGAIN_LABEL} onPress={onRequestAgain} />
      ) : null}
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    card: {
      backgroundColor: colors.purpleSoft,
      borderRadius: 16,
      padding: 12,
      gap: 8,
      borderWidth: 1,
      borderColor: colors.purple,
    },
    expired: {
      backgroundColor: colors.orangeSoft,
      borderColor: colors.orange,
    },
    kicker: {
      color: colors.orange,
      fontWeight: '800' as const,
      letterSpacing: 1.1,
      fontSize: 11,
    },
    copy: {
      color: colors.purple,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '700' as const,
    },
  }
}
