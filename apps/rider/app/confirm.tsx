import { GlassSheet } from 'rides-native/glass'
import { Glyph } from 'rides-native/icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Location from 'expo-location'
import { useEffect, useRef, useState } from 'react'
import { Animated, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton, SheetHandle } from '@/components/Button'
import { RetryAction } from '@/components/RetryAction'
import { useEnterMotion } from '@/components/enter'
import { CampusMap } from '@/components/CampusMap'
import type { CampusMapHandle } from '@/components/mapTypes'
import { SignInToBookSheet } from '@/components/SignInToBookSheet'
import { setAuthNext } from '@/lib/authNext'
import { logCaught } from '@/lib/caught'
import { retryableFailure } from '@/lib/offlineBanner'
import { useReconnectRetry } from '@/lib/useReconnectRetry'
import { useAuth } from '@/lib/auth'
import { oneParam } from '@/lib/oneParam'
import { lookupCatalogPlace, placeFromStop, type Place } from 'rides-native/shared/carpool.js'
import { destPoint } from 'rides-native/places.js'
import {
  airportCodeFromLabel,
  depositSurfaceCopy,
  previewAirportFare,
  studentSurfaceCopy,
} from 'rides-native/riderMoney.js'
import { useStudentStatus } from '@/lib/useStudentStatus'
import { NeighborhoodPicker } from '@/components/carpool/NeighborhoodPicker'
import { addressFromGeocode } from '@/lib/reverseAddress'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

export default function ConfirmPickup() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ dest?: string; tier?: string | string[] }>()
  const dest = oneParam(params.dest, 'GSP Airport')
  const tier = oneParam(params.tier)
  const { user } = useAuth()
  const student = useStudentStatus()
  const studentOffer = studentSurfaceCopy(student, 'confirm')
  const airport = airportCodeFromLabel(dest)
  const airportQuote = airport ? previewAirportFare({ airport, isStudent: student.verified }) : null
  const depositCopy = airportQuote
    ? depositSurfaceCopy(airportQuote, 'confirm', { studentDiscountCents: airportQuote.studentDiscountCents })
    : null
  const initialPickup = placeFromStop(lookupCatalogPlace('Memorial Stadium')) || { label: 'Memorial Stadium', lat: 34.6788, lng: -82.843 }
  const initialDrop = placeFromStop(lookupCatalogPlace(dest)) || {
    label: dest,
    lat: destPoint(dest).latitude,
    lng: destPoint(dest).longitude,
  }
  const [pickup, setPickup] = useState<Place>(initialPickup)
  const [dropoff, setDropoff] = useState<Place>(initialDrop)
  const [note, setNote] = useState('')
  const [locating, setLocating] = useState<'pickup' | 'dropoff' | null>(null)
  const [locateNote, setLocateNote] = useState<string | null>(null)
  const mapRef = useRef<CampusMapHandle>(null)
  const pickupEdited = useRef(false)
  const [promptOpen, setPromptOpen] = useState(false)
  const { colors, scheme } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const sheetMotion = useEnterMotion(18)

  const nextParams = {
    dest: dropoff.label,
    destLat: String(dropoff.lat),
    destLng: String(dropoff.lng),
    pickup: pickup.label,
    pickupLat: String(pickup.lat),
    pickupLng: String(pickup.lng),
    note,
    ...(tier ? { tier } : {}),
  }

  const goTiers = () => {
    router.push({ pathname: '/tiers', params: nextParams })
  }

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const place = await placeFromGps()
        if (!alive || pickupEdited.current) return
        setPickup(place)
        mapRef.current?.animateTo({ latitude: place.lat, longitude: place.lng }, 0.01)
      } catch (err) {
        if (!alive || pickupEdited.current) return
        setLocateNote(err instanceof Error ? err.message : 'Could not read your location. Type a pickup instead.')
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const onConfirm = () => {
    if (user) {
      goTiers()
      return
    }
    setAuthNext({ pathname: '/tiers', params: nextParams })
    setPromptOpen(true)
  }

  async function onLocate(which: 'pickup' | 'dropoff') {
    setLocating(which)
    setLocateNote(null)
    try {
      const permission = await Location.requestForegroundPermissionsAsync()
      if (permission.status !== 'granted') {
        setLocateNote('Location permission is off.')
        return
      }
      let position
      try {
        position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation })
      } catch (err) {
        logCaught('confirm-locate', err)
        position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      }
      const lat = position.coords.latitude
      const lng = position.coords.longitude
      let label = 'Current location'
      try {
        const reversed = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng })
        label = addressFromGeocode(reversed[0]) || label
      } catch (err) {
        logCaught('confirm-address', err)
        label = 'Current location'
      }
      const place = { label, lat, lng }
      if (which === 'dropoff') setDropoff(place)
      else {
        pickupEdited.current = true
        setPickup(place)
      }
      mapRef.current?.animateTo({ latitude: place.lat, longitude: place.lng }, 0.01)
    } catch (err) {
      setLocateNote(err instanceof Error ? err.message : 'Could not read your location.')
    } finally {
      setLocating(null)
    }
  }

  useReconnectRetry('confirm-pickup', () => onLocate('pickup'), retryableFailure(locateNote))

  return (
    <View style={styles.screen}>
      <View style={styles.map}>
        <CampusMap
          ref={mapRef}
          spots={[]}
          showHeat={false}
          pins={[{
            id: 'pickup',
            latitude: pickup.lat,
            longitude: pickup.lng,
            title: pickup.label,
            color: colors.orange,
          }, {
            id: 'dropoff',
            latitude: dropoff.lat,
            longitude: dropoff.lng,
            title: dropoff.label,
            color: colors.purple,
          }]}
        />
        <Pressable
          onPress={() => { void onLocate('pickup') }}
          disabled={locating != null}
          style={[styles.locate, lift(colors, 'float'), { top: insets.top + 10 }]}
          accessibilityRole="button"
          accessibilityLabel="Use current location as pickup"
          accessibilityHint="Pins your location as the pickup on the map"
          accessibilityState={{ busy: locating === 'pickup' }}
          hitSlop={8}
        >
          <Text style={styles.locateLabel}>{locating === 'pickup' ? '…' : '◎'}</Text>
        </Pressable>
        <Pressable
          onPress={() => router.back()}
          style={[styles.back, lift(colors, 'float'), { top: insets.top + 10 }]}
          accessibilityRole="button"
          accessibilityLabel="Back"
          accessibilityHint="Returns to the previous screen"
          hitSlop={8}
        >
          <Glyph name="back" size={20} color={colors.title} accessibilityLabel="Back" />
        </Pressable>
      </View>
      <Animated.View style={[styles.sheetWrap, lift(colors, 'float'), sheetMotion]}>
      <View style={styles.sheet}>
      <GlassSheet app="rider" scheme={scheme} pointerEvents="none" style={styles.sheetGlass} />
      <ScrollView
        style={styles.sheetScroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <SheetHandle />
        <Text style={styles.title}>Confirm pickup spot</Text>
        <Text style={styles.hint}>Pickup uses your current location. Edit it if you need a different spot.</Text>
        {locateNote ? <Text style={styles.locateNote}>{locateNote}</Text> : null}
        {retryableFailure(locateNote) ? (
          <RetryAction hint="Tries to read your pickup location again" onPress={() => { void onLocate('pickup') }} />
        ) : null}
        <NeighborhoodPicker
          liveSuggest
          label="Pickup address"
          value={pickup}
          onChange={(place) => {
            pickupEdited.current = true
            setPickup(place)
            mapRef.current?.animateTo({ latitude: place.lat, longitude: place.lng }, 0.01)
          }}
        />
        <NeighborhoodPicker
          liveSuggest
          label="Drop-off address"
          value={dropoff}
          onChange={(place) => {
            setDropoff(place)
            mapRef.current?.animateTo({ latitude: place.lat, longitude: place.lng }, 0.01)
          }}
        />
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
        <Text style={styles.fieldLabel}>Note for driver</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="e.g. Near the orange gates, wearing purple hoodie"
          placeholderTextColor={colors.placeholder}
          style={[styles.input, styles.note]}
          multiline
          accessibilityLabel="Note for driver"
        />
        <PrimaryButton label="Confirm pickup" onPress={onConfirm} />
      </ScrollView>
      </View>
      </Animated.View>
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

async function placeFromGps(): Promise<Place> {
  const permission = await Location.requestForegroundPermissionsAsync()
  if (permission.status !== 'granted') {
    throw new Error('Location permission is off. Type a pickup instead.')
  }
  let position
  try {
    position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation })
  } catch (err) {
    logCaught('confirm-locate', err)
    position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
  }
  const lat = position.coords.latitude
  const lng = position.coords.longitude
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error('Could not read your location. Type a pickup instead.')
  }
  let label = 'Current location'
  try {
    const reversed = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng })
    label = addressFromGeocode(reversed[0]) || label
  } catch (err) {
    logCaught('confirm-address', err)
    label = 'Current location'
  }
  return { label, lat, lng }
}

function makeStyles(colors: Palette) {
  return {
    screen: { flex: 1, backgroundColor: colors.background },
    back: {
      position: 'absolute' as const,
      left: 16,
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.card,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    backLabel: { fontSize: 18, color: colors.title, fontWeight: '700' as const },
    locate: {
      position: 'absolute' as const,
      right: 16,
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.card,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    locateLabel: { fontSize: 20, color: colors.orange, fontWeight: '700' as const },
    locateNote: { color: colors.danger, fontSize: 12, lineHeight: 17, marginBottom: 8 },
    title: { fontSize: 24, fontWeight: '700' as const, letterSpacing: -0.5, color: colors.title, marginBottom: 6 },
    map: { height: 300, backgroundColor: colors.mapFallback },
    hint: { color: colors.inkSecondary, fontSize: 13, lineHeight: 18, marginBottom: 14 },
    sheetWrap: {
      flex: 1,
      marginTop: -24,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
    },
    sheet: {
      flex: 1,
      overflow: 'hidden' as const,
      backgroundColor: 'transparent',
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingHorizontal: 20,
      paddingTop: 6,
    },
    sheetGlass: { position: 'absolute' as const, top: 0, right: 0, bottom: 0, left: 0 },
    sheetScroll: { flex: 1 },
    fieldLabel: { fontSize: 13, fontWeight: '700' as const, color: colors.title, marginBottom: 8, letterSpacing: 0.1 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 16,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 14,
      fontSize: 16,
      color: colors.ink,
      backgroundColor: colors.input,
    },
    note: { minHeight: 72, textAlignVertical: 'top' as const },
    deposit: { color: colors.purple, fontWeight: '700' as const, fontSize: 13, lineHeight: 18, marginBottom: 12 },
    studentOn: { color: colors.orange, fontWeight: '700' as const, fontSize: 13, lineHeight: 18, marginBottom: 14 },
    studentOff: { color: colors.link, fontWeight: '700' as const, fontSize: 13, lineHeight: 18, marginBottom: 14 },
  }
}
