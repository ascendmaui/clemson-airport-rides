import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { ScrollView, Switch, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { CarpoolCompare } from '@/components/carpool/CarpoolCompare'
import { NeighborhoodPicker } from '@/components/carpool/NeighborhoodPicker'
import { BackButton, Card, ErrorText, Field, SkeletonBlock, SplitModePicker } from '@/components/carpool/ui'
import { MainTabs } from '@/components/MainTabs'
import { setAuthNext } from '@/lib/authNext'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useRegisteredVehicle } from '@/lib/useRegisteredVehicle'
import { apiErrorMessage, createCarpoolOffer, recomputeFriendRide } from 'rides-native/shared/carpoolApi.js'
import { defaultCarpoolEnds, OFFER_CARPOOL_MAPS_NOTE, OFFER_CARPOOL_STEPS, riderDisplayName, type Place } from 'rides-native/shared/carpool.js'
import { capacityMessage, offerCapacity, vehicleMaxSeats } from 'rides-native/shared/vehicle.js'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

const START = defaultCarpoolEnds()

export default function OfferCarpoolScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const vehicleState = useRegisteredVehicle(user?.id)
  const [name, setName] = useState(riderDisplayName(user))
  const [pickup, setPickup] = useState<Place>(START.pickup)
  const [dropoff, setDropoff] = useState<Place>(START.dropoff)
  const [tailgate, setTailgate] = useState(false)
  const [splitMode, setSplitMode] = useState<'even' | 'by_distance'>('even')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useFocusEffect(useCallback(() => {
    void vehicleState.reload()
  }, [vehicleState.reload]))

  const vehicle = vehicleState.vehicle
  const hasVehicle = Boolean(vehicle)
  const vehicleBlock = vehicleState.loaded && !hasVehicle && !vehicleState.error
  const seats = vehicle ? vehicleMaxSeats(vehicle) : null
  const capacity = offerCapacity(vehicle, { tailgate })
  const carLine = hasVehicle && seats != null
    ? `(${[vehicle?.make, vehicle?.model].filter(Boolean).join(' ')} · up to ${seats} total)`.replace(/\s+/g, ' ').trim()
    : ''

  async function onCreate() {
    if (!user) {
      setAuthNext('/carpool/offer')
      router.push('/sign-in')
      return
    }
    if (vehicleBlock) {
      setError('Add your vehicle before offering a group ride.')
      return
    }
    if (!pickup.lat || !dropoff.lat) {
      setError('Choose a campus or airport stop for pickup and dropoff.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const created = await createCarpoolOffer(supabase, {
        displayName: name || 'Driver',
        pickup,
        dropoff,
        splitMode,
        partyType: tailgate ? 'tailgate' : 'carpool',
      })
      try {
        await recomputeFriendRide(supabase, created.token, splitMode)
      } catch {
        /* Lobby still opens. Confirm retries the fare split. */
      }
      router.replace(`/carpool/${created.token}`)
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 20, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <BackButton onPress={() => (router.canGoBack() ? router.back() : router.replace('/friends'))} />
        <Text style={styles.title}>Offer a carpool</Text>
        <Card>
          <Text style={styles.cardTitle}>How carpool works</Text>
          {OFFER_CARPOOL_STEPS.map((step, index) => (
            <Text key={step} style={styles.step}>{index + 1}. {step}</Text>
          ))}
          <Text style={styles.meta}>
            For Clemson student drivers with a registered car. Capacity comes from your vehicle{carLine ? ` ${carLine}` : ''}. {OFFER_CARPOOL_MAPS_NOTE}
          </Text>
        </Card>

        {!vehicleState.loaded ? (
          <Card>
            <SkeletonBlock height={16} width="50%" />
            <View style={{ height: 8 }} />
            <SkeletonBlock height={12} />
          </Card>
        ) : null}

        {vehicleBlock ? (
          <Card>
            <Text style={styles.warn}>Vehicle required</Text>
            <Text style={styles.meta}>{capacityMessage(0, { hasVehicle: false })} We use your registered seats to cap the party.</Text>
            <Text
              accessibilityRole="button"
              onPress={() => router.push('/carpool/add-vehicle')}
              style={styles.link}
            >
              Add your vehicle →
            </Text>
          </Card>
        ) : null}

        {capacity ? (
          <Card>
            <Text style={styles.cardTitle}>{capacity.title || 'Registered car'}</Text>
            <Text style={styles.meta}>{capacity.message}</Text>
            <Text style={styles.meta}>
              {capacity.plate ? `Plate ${capacity.plate}. ` : ''}
              This offer caps at {capacity.cap} rider{capacity.cap === 1 ? '' : 's'}
              {tailgate ? ' for a tailgate.' : '.'}
            </Text>
          </Card>
        ) : null}
        {vehicleState.error ? <ErrorText>{vehicleState.error}</ErrorText> : null}

        <Card>
          <Field label="Your name" value={name} onChangeText={setName} />
          <NeighborhoodPicker label="Your start" value={pickup} onChange={setPickup} />
          <NeighborhoodPicker label="Your end" value={dropoff} onChange={setDropoff} />
          <View style={styles.tailgate}>
            <Text style={styles.tailgateLabel}>Tailgate party (up to 6 if your vehicle fits)</Text>
            <Switch
              value={tailgate}
              onValueChange={setTailgate}
              trackColor={{ false: colors.track, true: colors.orange }}
              thumbColor={colors.onAccent}
            />
          </View>
          <SplitModePicker value={splitMode} onChange={setSplitMode} />
          <CarpoolCompare pickup={pickup} dropoff={dropoff} mode="pitch" />
          <View style={{ height: 12 }} />
          <PrimaryButton
            label={busy ? 'Creating…' : 'Offer a carpool'}
            onPress={onCreate}
            disabled={busy || vehicleBlock}
          />
          {error ? <ErrorText>{error}</ErrorText> : null}
        </Card>
      </ScrollView>
      <MainTabs active="friends" />
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    screen: { flex: 1, backgroundColor: colors.background },
    scroll: { flex: 1 },
    title: { fontSize: 28, fontWeight: '800' as const, color: colors.title, letterSpacing: -0.4 },
    cardTitle: { color: colors.title, fontWeight: '800' as const, fontSize: 16, marginBottom: 8 },
    step: { color: colors.inkSecondary, fontSize: 14, lineHeight: 22 },
    meta: { marginTop: 8, color: colors.inkSecondary, fontSize: 13, lineHeight: 18 },
    warn: { color: colors.orange, fontWeight: '800' as const, fontSize: 16 },
    link: { marginTop: 10, color: colors.link, fontWeight: '800' as const, fontSize: 15 },
    tailgate: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: 12, marginBottom: 12 },
    tailgateLabel: { flex: 1, fontWeight: '700' as const, fontSize: 14, color: colors.ink },
  }
}
