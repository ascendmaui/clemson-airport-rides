import { useRouter, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Card, ErrorText, Field, Primary } from '@/components/chrome'
import { StackPage } from '@/components/shell'
import { useAuth } from '@/lib/auth'
import { useFeedback } from '@/lib/feedback'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { loadVehicle, type VehicleRow } from 'rides-native/driverDesk'
import { saveRegisteredVehicle } from 'rides-native/shared/vehicle.js'

export default function VehiclesScreen() {
  const router = useRouter()
  const { user } = useAuth()
  const { pulse } = useFeedback()
  const { colors } = useTheme()
  const [vehicle, setVehicle] = useState<VehicleRow | null>(null)
  const [editing, setEditing] = useState(false)
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [color, setColor] = useState('')
  const [plate, setPlate] = useState('')
  const [seats, setSeats] = useState('4')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!user || !supabase) return
    const row = await loadVehicle(supabase, user.id)
    setVehicle(row)
    setMake(row?.make || '')
    setModel(row?.model || '')
    setColor(row?.color || '')
    setPlate(row?.plate || '')
    setSeats(String(row?.seats || 4))
  }, [user])

  useFocusEffect(useCallback(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : 'Could not load your vehicle'))
  }, [refresh]))

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

  const title = [vehicle?.color, vehicle?.make, vehicle?.model].filter(Boolean).join(' ')

  return (
    <StackPage title="Vehicles" onBack={() => router.back()}>
      {!user ? <Primary label="Sign in" onPress={() => router.push('/sign-in')} /> : null}
      {vehicle && !editing ? (
        <Card>
          <View style={[styles.hero, { backgroundColor: colors.track }]}>
            <Text style={{ fontSize: 42 }}>🚗</Text>
          </View>
          <Text style={[styles.name, { color: colors.ink }]}>{title || 'Your vehicle'}</Text>
          <Text style={{ color: colors.inkSecondary }}>{vehicle.plate || 'No plate'} · {vehicle.seats || 4} seats</Text>
          <Text style={{ color: colors.title, fontWeight: '800' }}>Rides</Text>
          <Primary label="Manage vehicle" onPress={() => setEditing(true)} tone="ghost" />
        </Card>
      ) : null}
      {!vehicle && !editing ? (
        <Card>
          <Text style={{ color: colors.title, fontWeight: '800' }}>No vehicle yet</Text>
          <Text style={{ color: colors.inkSecondary }}>Add the car riders will see on Pick a driver.</Text>
          <Primary label="Add vehicle" onPress={() => setEditing(true)} />
        </Card>
      ) : null}
      {editing ? (
        <Card>
          <Field label="Make" value={make} onChangeText={setMake} placeholder="Toyota" />
          <Field label="Model" value={model} onChangeText={setModel} placeholder="Corolla" />
          <Field label="Color" value={color} onChangeText={setColor} placeholder="Blue" />
          <Field label="Plate" value={plate} onChangeText={setPlate} placeholder="ABC123" />
          <Field label="Seats" value={seats} onChangeText={setSeats} keyboard="number-pad" />
          <Primary label={busy ? 'Saving…' : 'Save vehicle'} onPress={save} disabled={busy} />
          <Primary label="Cancel" onPress={() => setEditing(false)} tone="ghost" />
        </Card>
      ) : null}
      <Card>
        <Text style={{ color: colors.title, fontWeight: '800' }}>Tesla Model 3</Text>
        <Text style={{ color: colors.inkSecondary }}>The badge riders see is the existing fleet toggle. It does not dispatch a car.</Text>
        <Primary label="Open Tesla listing" onPress={() => router.push('/fleet')} tone="purple" />
      </Card>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </StackPage>
  )
}

const styles = StyleSheet.create({
  hero: { height: 120, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 24, fontWeight: '800' },
})
