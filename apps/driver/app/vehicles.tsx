import { Glyph } from 'rides-native/icons'
import { useRouter, useFocusEffect } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import { useCallback, useState } from 'react'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { Card, ErrorText, Field, Primary, Tag } from '@/components/chrome'
import { EmptyState, FadeIn } from '@/components/day'
import { StackPage } from '@/components/shell'
import { useAuth } from '@/lib/auth'
import { useFeedback } from '@/lib/feedback'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { loadVehicle, type VehicleRow } from 'rides-native/driverDesk'
import { saveRegisteredVehicle } from 'rides-native/shared/vehicle.js'
import { radius, type as typeScale } from 'rides-native/shared/theme.js'
import { COMFORT_FLEET_NOTICE, comfortFleetNotice } from 'rides-native/tripTags'
import { CONDITION_LEVELS } from '../../../shared/vehicleStandards.js'
import {
  DRIVER_RENTALS_BROWSE_URL,
  LUXURY_EXCEPTION_MESSAGE,
  OWN_OR_LEASE_LABEL,
  POOR_CONDITION_MESSAGE,
  RENT_FROM_PARTNER_LABEL,
  assessOwnedVehicle,
  isPreStandardYear,
} from '../../../shared/ownedVehicle.js'

const PAINT: Record<string, string> = {
  black: '#1C1C1E',
  white: '#F7F7F5',
  silver: '#C5C9D1',
  gray: '#8E8E93',
  grey: '#8E8E93',
  red: '#C0392B',
  blue: '#2E5A88',
  navy: '#1B3A4B',
  green: '#1F7A4D',
  orange: '#F56600',
  purple: '#522D80',
  gold: '#C4A35A',
  yellow: '#E2B93B',
  brown: '#6B4F3A',
  tan: '#C4A484',
  beige: '#E6D3B3',
  maroon: '#6E2430',
}

type OwnershipChoice = 'own' | 'rent'

function paintColor(name: string | null | undefined, fallback: string): string {
  const key = (name || '').trim().toLowerCase()
  return PAINT[key] || fallback
}

function fillForm(row: VehicleRow | null) {
  return {
    make: row?.make || '',
    model: row?.model || '',
    color: row?.color || '',
    plate: row?.plate || '',
    seats: String(row?.seats || 4),
    year: row?.year ? String(row.year) : '',
  }
}

export default function VehiclesScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const { pulse } = useFeedback()
  const { colors } = useTheme()
  const [vehicle, setVehicle] = useState<VehicleRow | null>(null)
  const [ready, setReady] = useState(!user)
  const [editing, setEditing] = useState(false)
  const [ownership, setOwnership] = useState<OwnershipChoice | null>(null)
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [color, setColor] = useState('')
  const [plate, setPlate] = useState('')
  const [seats, setSeats] = useState('4')
  const [year, setYear] = useState('')
  const [condition, setCondition] = useState('')
  const [luxuryPhotos, setLuxuryPhotos] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const applyRow = useCallback((row: VehicleRow | null) => {
    const next = fillForm(row)
    setVehicle(row)
    setMake(next.make)
    setModel(next.model)
    setColor(next.color)
    setPlate(next.plate)
    setSeats(next.seats)
    setYear(next.year)
    setCondition('')
    setLuxuryPhotos([])
    setOwnership(row ? 'own' : null)
  }, [])

  const refresh = useCallback(async () => {
    if (!user || !supabase) return
    applyRow(await loadVehicle(supabase, user.id))
  }, [applyRow, user])

  useFocusEffect(useCallback(() => {
    if (!user) {
      setReady(true)
      return undefined
    }
    let alive = true
    refresh()
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'Could not load your vehicle')
      })
      .finally(() => {
        if (alive) setReady(true)
      })
    return () => {
      alive = false
    }
  }, [refresh, user]))

  const ownedDecision = ownership === 'own'
    ? assessOwnedVehicle({ year, condition, luxuryPhotos })
    : null
  const luxuryPath = ownership === 'own' && isPreStandardYear(year)
  const poorBlocked = condition === 'poor'

  async function openRentals() {
    await Linking.openURL(DRIVER_RENTALS_BROWSE_URL)
  }

  async function addLuxuryPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      setError('Photo access is needed for a Luxury exception.')
      return
    }
    const shot = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    })
    const uri = shot.canceled ? '' : shot.assets?.[0]?.uri || ''
    if (!uri) return
    setLuxuryPhotos((prev) => [...prev, uri])
    setError(null)
  }

  async function save() {
    if (!user || !supabase) return
    if (ownership === 'rent') {
      await openRentals()
      return
    }
    if (ownership !== 'own') {
      setError('Choose whether you own or lease this car, or rent from a partner.')
      return
    }
    const decision = assessOwnedVehicle({ year, condition, luxuryPhotos })
    if (!decision.ok) {
      setError(decision.message)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await saveRegisteredVehicle(supabase, user.id, {
        make,
        model,
        color,
        plate,
        seats: Number(seats) || 4,
        comfortClass: vehicle?.service_class === 'comfort',
        year,
        condition,
        luxuryPhotos,
      })
      setEditing(false)
      pulse('online')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the vehicle')
    } finally {
      setBusy(false)
    }
  }

  function cancel() {
    const next = fillForm(vehicle)
    setMake(next.make)
    setModel(next.model)
    setColor(next.color)
    setPlate(next.plate)
    setSeats(next.seats)
    setYear(next.year)
    setCondition('')
    setLuxuryPhotos([])
    setOwnership(vehicle ? 'own' : null)
    setEditing(false)
    setError(null)
  }

  const title = [vehicle?.year, vehicle?.color, vehicle?.make, vehicle?.model].filter(Boolean).join(' ')
  const paint = paintColor(vehicle?.color, colors.purple)
  const listedNotice = comfortFleetNotice(vehicle?.service_class === 'comfort')
  const saveDisabled = busy || poorBlocked

  return (
    <StackPage title="Vehicles" onBack={() => router.back()}>
      <FadeIn style={{ gap: 12 }}>
        {!user ? (
          <EmptyState
            icon="log-in"
            title="Sign in to add a vehicle"
            body="The car riders see on Pick a driver is saved to the driver account you sign in with."
            action={<Primary label="Sign in" onPress={() => router.push('/sign-in')} />}
          />
        ) : null}
        {user && !ready ? (
          <Card>
            <Text style={{ color: colors.title, fontWeight: '800' }}>Loading your vehicle</Text>
            <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>Checking the car on your driver account.</Text>
          </Card>
        ) : null}
        {user && ready && vehicle && !editing ? (
          <Card>
            <View style={[styles.hero, { backgroundColor: colors.track }]}>
              <View style={[styles.swatch, { backgroundColor: paint, borderColor: colors.border }]} />
              <Glyph name="car-sport" size={42} color={colors.purple} />
            </View>
            <View style={styles.titleRow}>
              <Text style={[styles.name, { color: colors.ink }]}>{title || 'Your vehicle'}</Text>
              {vehicle.service_class === 'comfort' ? <Tag label="Extra Comfort" tone="orange" /> : null}
              {vehicle.luxury_exception ? <Tag label="Luxury exception" tone="purple" /> : null}
            </View>
            {listedNotice ? (
              <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>{listedNotice}</Text>
            ) : null}
            <View style={styles.specs}>
              <Spec label="Plate" value={vehicle.plate || 'Add plate'} />
              <Spec label="Seats" value={String(vehicle.seats || 4)} />
              <Spec label="Year" value={vehicle.year ? String(vehicle.year) : 'Add year'} />
            </View>
            <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
              Riders see this car on Pick a driver. Plate and color should match the car you bring.
            </Text>
            <Primary label="Manage vehicle" onPress={() => setEditing(true)} tone="ghost" />
          </Card>
        ) : null}
        {user && ready && !vehicle && !editing ? (
          <EmptyState
            icon="car-sport"
            title="No vehicle yet"
            body="Add the car riders will see on Pick a driver. Make, color, plate, and seats show on the trip card."
            action={<Primary label="Add vehicle" onPress={() => setEditing(true)} />}
          />
        ) : null}
        {editing ? (
          <Card>
            <Text style={{ color: colors.title, fontWeight: '800', fontSize: 18 }}>
              {vehicle ? 'Update your vehicle' : 'Add your vehicle'}
            </Text>
            <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
              This is the car riders match at pickup. It does not dispatch a different vehicle.
            </Text>
            <OwnershipPicker value={ownership} onChange={(next) => { setOwnership(next); setError(null) }} />
            {ownership === 'rent' ? (
              <View style={{ gap: 8 }}>
                <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
                  Browse weekly rentals from Clemson Rides partners.
                </Text>
                <Primary label="Browse partner rentals" onPress={() => { void openRentals() }} accessibilityRole="link" />
              </View>
            ) : null}
            {ownership === 'own' ? (
              <View style={{ gap: 10 }}>
                <Field label="Year" value={year} onChangeText={setYear} keyboard="number-pad" placeholder="2019" />
                <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
                  2019 or newer is accepted. Older cars use the Luxury exception path.
                </Text>
                <ConditionPicker value={condition} onChange={(next) => { setCondition(next); setError(null) }} />
                {poorBlocked ? <ErrorText>{POOR_CONDITION_MESSAGE}</ErrorText> : null}
                {luxuryPath && ownedDecision && !ownedDecision.ok && ownedDecision.code === 'luxury_photos' ? <ErrorText>{ownedDecision.message}</ErrorText> : null}
                {luxuryPath ? (
                  <View style={{ gap: 8 }}>
                    <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>{LUXURY_EXCEPTION_MESSAGE}</Text>
                    <Text style={{ color: colors.ink, fontWeight: '700' }}>
                      Luxury photos: {luxuryPhotos.length}
                    </Text>
                    <Primary label="Add photo" onPress={() => { void addLuxuryPhoto() }} tone="purple" />
                  </View>
                ) : null}
                <Field label="Make" value={make} onChangeText={setMake} placeholder="Toyota" />
                <Field label="Model" value={model} onChangeText={setModel} placeholder="Corolla" />
                <Field label="Color" value={color} onChangeText={setColor} placeholder="Blue" />
                <Field label="Plate" value={plate} onChangeText={setPlate} placeholder="ABC123" />
                <Field label="Seats" value={seats} onChangeText={setSeats} keyboard="number-pad" />
                <Primary label={busy ? 'Saving…' : 'Save vehicle'} onPress={save} disabled={saveDisabled} />
              </View>
            ) : null}
            <Primary label="Cancel" onPress={cancel} tone="ghost" />
          </Card>
        ) : null}
        <Card>
          <Text style={{ color: colors.orange, fontWeight: '800', letterSpacing: 1.1, fontSize: 12 }}>FLEET</Text>
          <Text style={{ color: colors.title, fontWeight: '800', fontSize: 18 }}>Extra Comfort</Text>
          <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
            {COMFORT_FLEET_NOTICE}
          </Text>
          <Primary label="Open Comfort listing" onPress={() => router.push('/fleet')} tone="purple" />
        </Card>
        {error ? <ErrorText>{error}</ErrorText> : null}
      </FadeIn>
    </StackPage>
  )
}

function OwnershipPicker({ value, onChange }: { value: OwnershipChoice | null; onChange: (value: OwnershipChoice) => void }) {
  const { colors } = useTheme()
  const choices: { id: OwnershipChoice; label: string }[] = [
    { id: 'own', label: OWN_OR_LEASE_LABEL },
    { id: 'rent', label: RENT_FROM_PARTNER_LABEL },
  ]
  return (
    <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
      {choices.map((choice) => {
        const on = value === choice.id
        return (
          <Pressable
            key={choice.id}
            onPress={() => onChange(choice.id)}
            accessibilityRole="radio"
            accessibilityLabel={choice.label}
            accessibilityState={{ selected: on }}
            style={[styles.choice, { borderColor: on ? colors.purple : colors.border, backgroundColor: on ? colors.track : colors.input }]}
          >
            <Text style={{ color: colors.ink, fontWeight: '700' }}>{choice.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

function ConditionPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { colors } = useTheme()
  return (
    <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
      <Text style={{ color: colors.inkSecondary, fontSize: 13, fontWeight: '700' }}>Condition</Text>
      <View style={styles.conditions}>
        {CONDITION_LEVELS.map((level) => {
          const on = value === level.id
          return (
            <Pressable
              key={level.id}
              onPress={() => onChange(level.id)}
              accessibilityRole="radio"
              accessibilityLabel={level.label}
              accessibilityState={{ selected: on }}
              style={[styles.choice, styles.condition, { borderColor: on ? colors.orange : colors.border, backgroundColor: on ? colors.track : colors.input }]}
            >
              <Text style={{ color: colors.ink, fontWeight: '700' }}>{level.label}</Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

function Spec({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme()
  return (
    <View style={[styles.spec, { backgroundColor: colors.input }]}>
      <Text style={{ color: colors.inkSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 0.6 }}>{label.toUpperCase()}</Text>
      <Text style={{ color: colors.ink, fontWeight: '800' }} numberOfLines={1}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  hero: { height: 132, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  swatch: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  name: { fontSize: 24, fontWeight: typeScale.title.fontWeight, letterSpacing: typeScale.headline.letterSpacing },
  specs: { flexDirection: 'row', gap: 8 },
  spec: { flex: 1, borderRadius: radius.lg, paddingHorizontal: 10, paddingVertical: 10, gap: 4 },
  choice: { borderRadius: radius.lg, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 12 },
  conditions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  condition: { flexGrow: 1 },
})
