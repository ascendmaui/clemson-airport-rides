import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { CampusMap, type MapPin } from '@/components/CampusMap'
import { FarePanel } from '@/components/FarePanel'
import { Card, ErrorText, Primary } from '@/components/chrome'
import { StackPage } from '@/components/shell'
import { useAuth } from '@/lib/auth'
import { straightLineMiles, tipCentsFromPayments, type TipPayment } from '@/lib/earningsMath'
import { oneParam } from '@/lib/oneParam'
import { shownCents } from '@/lib/shown'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { loadEarnings, loadTrip } from 'rides-native/driverDesk'
import { formatCents, formatPickupAt, teslaFleetNotice, type DriverCard } from 'rides-native/tripTags'
import { ORANGE, PURPLE } from 'rides-native/places.js'

export default function TripDetailsScreen() {
  const router = useRouter()
  const params = useLocalSearchParams<{ id?: string }>()
  const id = oneParam(params.id)
  const { user } = useAuth()
  const { colors, scheme, earningsPrivate } = useTheme()
  const [trip, setTrip] = useState<DriverCard | null>(null)
  const [tip, setTip] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!supabase || !id) return
    const row = await loadTrip(supabase, id, user?.id)
    setTrip(row)
    if (!user) return
    const earnings = await loadEarnings(supabase, user.id).catch(() => null)
    const payments = (earnings?.paymentsByTrip?.[id] || []) as TipPayment[]
    const cents = tipCentsFromPayments(payments)
    setTip(payments.some((payment) => payment.kind === 'tip') ? cents : null)
  }, [id, user])

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : 'Could not load this trip'))
  }, [refresh])

  const pins: MapPin[] = []
  if (trip?.pickupLat != null && trip.pickupLng != null) {
    pins.push({ id: 'pickup', latitude: trip.pickupLat, longitude: trip.pickupLng, title: trip.pickupLabel, pinColor: PURPLE })
  }
  if (trip?.dropoffLat != null && trip.dropoffLng != null) {
    pins.push({ id: 'drop', latitude: trip.dropoffLat, longitude: trip.dropoffLng, title: trip.dropoffLabel, pinColor: ORANGE })
  }
  const route = pins.map((pin) => ({ latitude: pin.latitude, longitude: pin.longitude }))
  const miles = straightLineMiles(
    trip?.pickupLat != null && trip.pickupLng != null ? { latitude: trip.pickupLat, longitude: trip.pickupLng } : null,
    trip?.dropoffLat != null && trip.dropoffLng != null ? { latitude: trip.dropoffLat, longitude: trip.dropoffLng } : null,
  )
  const when = trip?.pickupAt ? formatPickupAt(trip.pickupAt) : 'Time not recorded'
  const teslaNotice = teslaFleetNotice(Boolean(trip?.teslaStub))

  return (
    <StackPage
      title="Trip details"
      onBack={() => router.back()}
      right={<Text style={{ color: colors.orange, fontWeight: '800' }} onPress={() => router.push('/learning')}>?</Text>}
    >
      {!trip ? <Text style={{ color: colors.inkSecondary }}>{id ? 'This trip is not on your account yet.' : 'Missing trip id.'}</Text> : null}
      {trip ? (
        <>
          <Text style={{ color: colors.inkSecondary }}>Clemson RIDES · {when}</Text>
          <Text style={{ color: colors.ink, fontSize: 40, fontWeight: '800' }}>{shownCents(trip.driverNetCents, earningsPrivate)}</Text>
          <Text style={{ color: colors.inkSecondary }}>Upfront fare {shownCents(trip.fareCents, earningsPrivate)}</Text>
          {trip.carpoolIncentiveId ? (
            <Text style={{ color: colors.inkSecondary }}>
              Base net {shownCents(trip.baseNetCents || 0, earningsPrivate)} · {trip.carpoolIncentiveId} {shownCents(trip.carpoolBonusCents || 0, earningsPrivate)} · total {shownCents(trip.driverPayoutCents || trip.driverNetCents, earningsPrivate)}
            </Text>
          ) : null}
          {tip != null && tip > 0 ? (
            <Card>
              <Text style={{ color: colors.online, fontWeight: '800' }}>
                You earned more because the rider left a tip. {shownCents(tip, earningsPrivate)} is included when the payment row says so.
              </Text>
            </Card>
          ) : null}
          <View style={{ height: 180, borderRadius: 18, overflow: 'hidden' }}>
            <CampusMap
              pins={pins}
              center={pins[0] ? { latitude: pins[0].latitude, longitude: pins[0].longitude } : null}
              route={route.length > 1 ? route : undefined}
              colorScheme={scheme}
            />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View>
              <Text style={{ color: colors.inkSecondary }}>Duration</Text>
              <Text style={{ color: colors.ink, fontWeight: '800' }}>Not recorded</Text>
            </View>
            <View>
              <Text style={{ color: colors.inkSecondary }}>Distance</Text>
              <Text style={{ color: colors.ink, fontWeight: '800' }}>{miles == null ? 'Not recorded' : `${miles.toFixed(2)} mi straight-line`}</Text>
            </View>
          </View>
          <Card>
            <Text style={{ color: colors.ink }}>{trip.pickupLabel}</Text>
            <Text style={{ color: colors.ink }}>{trip.dropoffLabel}</Text>
          </Card>
          {teslaNotice ? (
            <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>{teslaNotice}</Text>
          ) : null}
          {tip != null ? (
            <Text style={{ color: colors.title, fontWeight: '800' }}>
              {tip > 0 ? `${formatCents(tip)} tip on the payment record` : 'Tip row is zero'}
            </Text>
          ) : (
            <Text style={{ color: colors.inkSecondary }}>No tip payment is on this trip.</Text>
          )}
          <Text style={{ color: colors.inkSecondary }}>Thanks notes are not sent from the driver app yet.</Text>
          <FarePanel card={trip} />
          <Primary label="Open live trip" onPress={() => router.push({ pathname: '/trip', params: { id: trip.id } })} tone="purple" />
          {trip.status === 'completed' ? (
            <Primary label="Rate your rider" onPress={() => router.push({ pathname: '/rate', params: { trip: trip.id } })} />
          ) : null}
        </>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </StackPage>
  )
}
