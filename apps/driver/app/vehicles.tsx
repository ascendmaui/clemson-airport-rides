import { Ionicons } from '@expo/vector-icons'
import { useRouter, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Card, ErrorText, Field, Primary, Tag } from '@/components/chrome'
import { EmptyState, FadeIn } from '@/components/day'
import { StackPage } from '@/components/shell'
import { useAuth } from '@/lib/auth'
import { useFeedback } from '@/lib/feedback'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { loadVehicle, type VehicleRow } from 'rides-native/driverDesk'
import { saveRegisteredVehicle } from 'rides-native/shared/vehicle.js'

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
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [color, setColor] = useState('')
  const [plate, setPlate] = useState('')
  const [seats, setSeats] = useState('4')
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
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : 'Could not load your vehicle')
      })
      .finally(() => {
        if (alive) setReady(true)
      })
    return () => {
      alive = false
    }
  }, [refresh, user]))

  async function save() {
    if (!user || !supabase) return
    setBusy(true)
    setError(null)
    try {
      await saveRegisteredVehicle(supabase, user.id, {
        make,
        model,
        color,
        plate,
        seats: Number(seats) || 4,
        isTesla: Boolean(vehicle?.is_tesla),
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
    setEditing(false)
  }

  const title = [vehicle?.color, vehicle?.make, vehicle?.model].filter(Boolean).join(' ')
  const paint = paintColor(vehicle?.color, colors.purple)

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
              <Ionicons name="car-sport" size={42} color={colors.purple} />
            </View>
            <View style={styles.titleRow}>
              <Text style={[styles.name, { color: colors.ink }]}>{title || 'Your vehicle'}</Text>
              {vehicle.is_tesla ? <Tag label="Tesla" tone="orange" /> : null}
            </View>
            <View style={styles.specs}>
              <Spec label="Plate" value={vehicle.plate || 'Add plate'} />
              <Spec label="Seats" value={String(vehicle.seats || 4)} />
              <Spec label="Color" value={vehicle.color || 'Add color'} />
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
            <Field label="Make" value={make} onChangeText={setMake} placeholder="Toyota" />
            <Field label="Model" value={model} onChangeText={setModel} placeholder="Corolla" />
            <Field label="Color" value={color} onChangeText={setColor} placeholder="Blue" />
            <Field label="Plate" value={plate} onChangeText={setPlate} placeholder="ABC123" />
            <Field label="Seats" value={seats} onChangeText={setSeats} keyboard="number-pad" />
            <Primary label={busy ? 'Saving…' : 'Save vehicle'} onPress={save} disabled={busy} />
            <Primary label="Cancel" onPress={cancel} tone="ghost" />
          </Card>
        ) : null}
        <Card>
          <Text style={{ color: colors.orange, fontWeight: '800', letterSpacing: 1.1, fontSize: 12 }}>FLEET</Text>
          <Text style={{ color: colors.title, fontWeight: '800', fontSize: 18 }}>Tesla Model 3</Text>
          <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
            The badge riders see is the existing fleet toggle. It does not dispatch a car.
          </Text>
          <Primary label="Open Tesla listing" onPress={() => router.push('/fleet')} tone="purple" />
        </Card>
        {error ? <ErrorText>{error}</ErrorText> : null}
      </FadeIn>
    </StackPage>
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
  hero: { height: 132, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
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
  name: { fontSize: 24, fontWeight: '800', letterSpacing: -0.3 },
  specs: { flexDirection: 'row', gap: 8 },
  spec: { flex: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 10, gap: 4 },
})
