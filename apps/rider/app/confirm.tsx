import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton, SheetHandle } from '@/components/Button'
import { CampusMap } from '@/components/CampusMap'
import { SignInToBookSheet } from '@/components/SignInToBookSheet'
import { setAuthNext } from '@/lib/authNext'
import { useAuth } from '@/lib/auth'
import { oneParam } from '@/lib/oneParam'
import { lookupCatalogPlace, placeFromStop, type Place } from 'rides-native/shared/carpool.js'
import { CURRENT_LOCATION_LABEL, destPoint, resolvePickupPoint } from 'rides-native/places.js'
import { currentLocationDeniedCopy, readCurrentLocationPickup } from '@/lib/readCurrentLocation'
import { useDrivingPreview } from '@/lib/useDrivingPreview'
import {
  airportCodeFromLabel,
  depositSurfaceCopy,
  previewAirportFare,
  studentSurfaceCopy,
} from 'rides-native/riderMoney.js'
import { useStudentStatus } from '@/lib/useStudentStatus'
import { NeighborhoodPicker } from '@/components/carpool/NeighborhoodPicker'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

export default function ConfirmPickup() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ dest?: string; pickup?: string; pickupLat?: string; pickupLng?: string }>()
  const dest = oneParam(params.dest, 'GSP Airport')
  const incomingLabel = oneParam(params.pickup)
  const incomingLat = oneParam(params.pickupLat)
  const incomingLng = oneParam(params.pickupLng)
  const { user } = useAuth()
  const student = useStudentStatus()
  const studentOffer = studentSurfaceCopy(student, 'confirm')
  const airport = airportCodeFromLabel(dest)
  const airportQuote = airport ? previewAirportFare({ airport, isStudent: student.verified }) : null
  const depositCopy = airportQuote
    ? depositSurfaceCopy(airportQuote, 'confirm', { studentDiscountCents: airportQuote.studentDiscountCents })
    : null
  const seeded = (incomingLabel || incomingLat)
    ? resolvePickupPoint(incomingLabel, incomingLat, incomingLng)
    : null
  const initialPickup = seeded
    ? { label: seeded.label, lat: seeded.latitude, lng: seeded.longitude }
    : (placeFromStop(lookupCatalogPlace('Memorial Stadium')) || { label: 'Memorial Stadium', lat: 34.6788, lng: -82.843 })
  const [pickup, setPickup] = useState<Place>(initialPickup)
  const [address, setAddress] = useState(initialPickup.label)
  const [fromDevice, setFromDevice] = useState(Boolean(seeded?.fromDevice))
  const [note, setNote] = useState('')
  const [promptOpen, setPromptOpen] = useState(false)
  const [locatingPickup, setLocatingPickup] = useState(false)
  const [pickupNote, setPickupNote] = useState<string | null>(null)
  const drop = destPoint(dest)
  const preview = useDrivingPreview(
    fromDevice ? [pickup.lat, pickup.lng] : null,
    fromDevice ? [drop.latitude, drop.longitude] : null,
  )
  const route = useMemo(
    () => (preview?.path || []).map(([latitude, longitude]) => ({ latitude, longitude })),
    [preview],
  )
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)

  const tierParams = fromDevice
    ? { dest, pickup: address, note, pickupLat: String(pickup.lat), pickupLng: String(pickup.lng) }
    : { dest, pickup: address, note }

  const goTiers = () => {
    router.push({ pathname: '/tiers', params: tierParams })
  }

  const onConfirm = () => {
    if (user) {
      goTiers()
      return
    }
    setAuthNext({ pathname: '/tiers', params: tierParams })
    setPromptOpen(true)
  }

  async function onCurrentLocation() {
    setLocatingPickup(true)
    setPickupNote(null)
    try {
      const result = await readCurrentLocationPickup()
      if (!result.ok) {
        setPickupNote(currentLocationDeniedCopy(result.reason))
        return
      }
      setPickup(result.place)
      setAddress(result.place.label)
      setFromDevice(true)
    } finally {
      setLocatingPickup(false)
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={[styles.back, lift(colors, 'rest')]}
          accessibilityRole="button"
          accessibilityLabel="Back"
          accessibilityHint="Returns to the previous screen"
          hitSlop={8}
        >
          <Text style={styles.backLabel}>←</Text>
        </Pressable>
        <Text style={styles.title}>Confirm pickup spot</Text>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">
      <View style={styles.map}>
        <CampusMap
          spots={[]}
          showHeat={false}
          fitPins={fromDevice}
          route={route}
          pins={[
            {
              id: 'pickup',
              latitude: pickup.lat,
              longitude: pickup.lng,
              title: pickup.label,
              color: colors.purple,
            },
            ...(fromDevice ? [{
              id: 'dropoff',
              latitude: drop.latitude,
              longitude: drop.longitude,
              title: dest,
              color: colors.orange,
            }] : []),
          ]}
        />
      </View>
      {fromDevice ? (
        <Text style={styles.eta}>To destination · {preview?.etaLabel || 'Estimating…'}</Text>
      ) : null}
      <Text style={styles.hint}>Pickup is a campus or airport stop, or your current location.</Text>
      <View style={[styles.sheet, lift(colors, 'float')]}>
        <SheetHandle />
        <NeighborhoodPicker
          label="Pickup"
          value={pickup}
          currentLocationBusy={locatingPickup}
          onCurrentLocation={() => { void onCurrentLocation() }}
          onChange={(next) => {
            setPickup(next)
            setAddress(next.label)
            setFromDevice(false)
            setPickupNote(null)
          }}
        />
        {pickupNote ? <Text style={styles.pickupNote}>{pickupNote}</Text> : null}
        {fromDevice ? <Text style={styles.eta}>Pickup · {CURRENT_LOCATION_LABEL}</Text> : null}
        <Text style={styles.fieldLabel}>Add note for driver</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="e.g. Near the orange gates, wearing purple hoodie"
          placeholderTextColor={colors.placeholder}
          style={[styles.input, styles.note]}
          multiline
          accessibilityLabel="Note for driver"
        />
        <Text style={styles.going}>
          Going to <Text style={styles.goingStrong}>{dest}</Text>
        </Text>
        {depositCopy ? <Text style={styles.deposit}>{depositCopy}</Text> : null}
        <Pressable
          onPress={() => router.push(user ? '/student' : '/sign-in')}
          accessibilityRole="button"
          accessibilityLabel={studentOffer.title}
          accessibilityHint={user ? 'Opens student pricing' : 'Sign in to check student pricing'}
          hitSlop={14}
        >
          <Text style={studentOffer.granted ? styles.studentOn : styles.studentOff}>
            {studentOffer.title}
          </Text>
        </Pressable>
        <PrimaryButton label="Confirm pickup" onPress={onConfirm} />
      </View>
      </ScrollView>
      <SignInToBookSheet
        open={promptOpen}
        onClose={() => setPromptOpen(false)}
        onSignIn={() => {
          setPromptOpen(false)
          router.push('/sign-in')
        }}
        onSignUp={() => {
          setPromptOpen(false)
          router.push('/sign-up')
        }}
      />
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    screen: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
    back: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.card, alignItems: 'center' as const, justifyContent: 'center' as const },
    backLabel: { fontSize: 18, color: colors.title, fontWeight: '700' as const },
    title: { fontSize: 20, fontWeight: '600' as const, color: colors.ink },
    map: { height: 260, marginHorizontal: 16, borderRadius: 18, overflow: 'hidden' as const },
    hint: { textAlign: 'center' as const, color: colors.placeholder, fontSize: 12, marginTop: 8 },
    eta: { textAlign: 'center' as const, color: colors.purple, fontSize: 14, fontWeight: '800' as const, marginTop: 8 },
    pickupNote: { color: colors.danger, fontSize: 13, fontWeight: '600' as const, marginBottom: 8 },
    sheet: {
      marginTop: 12,
      backgroundColor: colors.card,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 20,
      paddingBottom: 28,
    },
    fieldLabel: { fontSize: 13, fontWeight: '600' as const, color: colors.inkSecondary, marginBottom: 6 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 14,
      fontSize: 16,
      color: colors.ink,
      backgroundColor: colors.input,
    },
    note: { minHeight: 64, textAlignVertical: 'top' as const },
    going: { fontSize: 13, color: colors.inkSecondary, marginBottom: 14 },
    goingStrong: { color: colors.ink, fontWeight: '700' as const },
    deposit: { color: colors.purple, fontWeight: '700' as const, fontSize: 13, lineHeight: 18, marginBottom: 12 },
    studentOn: { color: colors.orange, fontWeight: '800' as const, fontSize: 13, marginBottom: 12 },
    studentOff: { color: colors.link, fontWeight: '800' as const, fontSize: 13, marginBottom: 12 },
  }
}
