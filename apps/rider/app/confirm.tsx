import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { Animated, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton, SheetHandle } from '@/components/Button'
import { useEnterMotion } from '@/components/enter'
import { CampusMap } from '@/components/CampusMap'
import { SignInToBookSheet } from '@/components/SignInToBookSheet'
import { setAuthNext } from '@/lib/authNext'
import { useAuth } from '@/lib/auth'
import { oneParam } from '@/lib/oneParam'
import { lookupCatalogPlace, placeFromStop, type Place } from 'rides-native/shared/carpool.js'
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
  const params = useLocalSearchParams<{ dest?: string }>()
  const dest = oneParam(params.dest, 'GSP Airport')
  const { user } = useAuth()
  const student = useStudentStatus()
  const studentOffer = studentSurfaceCopy(student, 'confirm')
  const airport = airportCodeFromLabel(dest)
  const airportQuote = airport ? previewAirportFare({ airport, isStudent: student.verified }) : null
  const depositCopy = airportQuote
    ? depositSurfaceCopy(airportQuote, 'confirm', { studentDiscountCents: airportQuote.studentDiscountCents })
    : null
  const initialPickup = placeFromStop(lookupCatalogPlace('Memorial Stadium')) || { label: 'Memorial Stadium', lat: 34.6788, lng: -82.843 }
  const [pickup, setPickup] = useState<Place>(initialPickup)
  const [address, setAddress] = useState(initialPickup.label)
  const [note, setNote] = useState('')
  const [promptOpen, setPromptOpen] = useState(false)
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const sheetMotion = useEnterMotion(18)

  const goTiers = () => {
    router.push({ pathname: '/tiers', params: { dest, pickup: address, note } })
  }

  const onConfirm = () => {
    if (user) {
      goTiers()
      return
    }
    setAuthNext({ pathname: '/tiers', params: { dest, pickup: address, note } })
    setPromptOpen(true)
  }

  return (
    <View style={styles.screen}>
      <View style={styles.map}>
        <CampusMap
          spots={[]}
          showHeat={false}
          pins={[{
            id: 'pickup',
            latitude: pickup.lat,
            longitude: pickup.lng,
            title: pickup.label,
            color: colors.orange,
          }]}
        />
        <Pressable
          onPress={() => router.back()}
          style={[styles.back, lift(colors, 'float'), { top: insets.top + 10 }]}
          accessibilityRole="button"
          accessibilityLabel="Back"
          accessibilityHint="Returns to the previous screen"
          hitSlop={8}
        >
          <Text style={styles.backLabel}>←</Text>
        </Pressable>
      </View>
      <Animated.View style={[styles.sheetWrap, lift(colors, 'float'), sheetMotion]}>
      <View style={styles.sheet}>
      <ScrollView
        style={styles.sheetScroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <SheetHandle />
        <Text style={styles.title}>Confirm pickup spot</Text>
        <Text style={styles.hint}>Pickup is a campus or airport stop. Dragging the pin still needs a live Maps session.</Text>
        <View style={styles.destCard}>
          <View style={styles.destDot} />
          <Text style={styles.going}>
            Going to <Text style={styles.goingStrong}>{dest}</Text>
          </Text>
        </View>
        <NeighborhoodPicker
          label="Pickup"
          value={pickup}
          onChange={(next) => {
            setPickup(next)
            setAddress(next.label)
          }}
        />
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
      backgroundColor: colors.elevated,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingHorizontal: 20,
      paddingTop: 6,
    },
    sheetScroll: { flex: 1 },
    destCard: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 10,
      backgroundColor: colors.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginBottom: 16,
    },
    destDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.orange },
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
    going: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.inkSecondary },
    goingStrong: { color: colors.ink, fontWeight: '700' as const },
    deposit: { color: colors.purple, fontWeight: '700' as const, fontSize: 13, lineHeight: 18, marginBottom: 12 },
    studentOn: { color: colors.orange, fontWeight: '700' as const, fontSize: 13, lineHeight: 18, marginBottom: 14 },
    studentOff: { color: colors.link, fontWeight: '700' as const, fontSize: 13, lineHeight: 18, marginBottom: 14 },
  }
}
