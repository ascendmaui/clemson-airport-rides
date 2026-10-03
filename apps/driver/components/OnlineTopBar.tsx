import { useRouter } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useDriverShift } from '@/lib/driverShiftSession'
import { formatCents } from 'rides-native/driverDesk'

/** Persistent online banner, plus an offer row when a request arrives off Home. */
export function OnlineTopBar() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const shift = useDriverShift()
  if (!shift.ready || !shift.online) return null
  const offer = shift.showOfferBanner ? shift.incomingOffer : null
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingTop: insets.top + 6 }]}>
      <View style={styles.onlineBar} accessibilityRole="text" accessibilityLiveRegion="polite">
        <Text style={styles.onlineText}>Clemson Rides, you are online.</Text>
      </View>
      {offer ? (
        <Pressable
          style={styles.offer}
          accessibilityRole="button"
          accessibilityLabel={`New ride offer, ${offer.pickupLabel} to ${offer.dropoffLabel}`}
          onPress={() => {
            shift.dismissIncoming()
            router.push('/')
          }}
        >
          <Text style={styles.offerKicker}>New ride offer</Text>
          <Text style={styles.offerBody} numberOfLines={2}>
            {formatCents(offer.driverNetCents)} · {offer.pickupLabel} → {offer.dropoffLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 40,
    paddingHorizontal: 12,
    gap: 8,
  },
  onlineBar: {
    backgroundColor: '#522D80',
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  onlineText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  offer: {
    backgroundColor: '#F56600',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  offerKicker: { color: '#fff', fontWeight: '800', fontSize: 12, letterSpacing: 0.3 },
  offerBody: { color: '#fff', fontWeight: '700', fontSize: 14, marginTop: 2 },
})
