import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, Switch, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { BackButton, Card, EmptyState, ErrorText, Field } from '@/components/carpool/ui'
import { MainTabs } from '@/components/MainTabs'
import { setAuthNext } from '@/lib/authNext'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { saveRegisteredVehicle } from 'rides-native/shared/vehicle.js'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'

export default function AddVehicleScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [color, setColor] = useState('')
  const [plate, setPlate] = useState('')
  const [seats, setSeats] = useState(4)
  const [isTesla, setIsTesla] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function leave() {
    if (router.canGoBack()) router.back()
    else router.replace('/carpool/offer')
  }

  async function onSave() {
    if (!user) {
      setAuthNext('/carpool/add-vehicle')
      router.push('/sign-in')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await saveRegisteredVehicle(supabase, user.id, { make, model, color, plate, seats, isTesla })
      leave()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the vehicle')
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
        <BackButton onPress={leave} />
        <Text style={styles.title}>Add your vehicle</Text>
        <Text style={styles.copy}>
          Seats on this car cap a carpool. The same vehicle record is what an offer uses.
        </Text>
        {!user ? (
          <EmptyState title="Sign in to add a vehicle" body="Your car is saved on the Clemson RIDES account you use to offer seats." />
        ) : (
          <Card>
            <Field label="Make" value={make} onChangeText={setMake} placeholder="Honda" />
            <Field label="Model" value={model} onChangeText={setModel} placeholder="Civic" />
            <Field label="Color" value={color} onChangeText={setColor} placeholder="Orange" />
            <Field label="Plate" value={plate} onChangeText={setPlate} autoCapitalize="characters" placeholder="TIGER1" />
            <Text style={styles.seatLabel}>Seats including you</Text>
            <View style={styles.stepper}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Fewer seats"
                onPress={() => setSeats((value) => Math.max(1, value - 1))}
                style={styles.stepBtn}
              >
                <Text style={styles.stepBtnText}>−</Text>
              </Pressable>
              <Text style={styles.seatCount}>{seats}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="More seats"
                onPress={() => setSeats((value) => Math.min(8, value + 1))}
                style={styles.stepBtn}
              >
                <Text style={styles.stepBtnText}>+</Text>
              </Pressable>
            </View>
            <View style={styles.tesla}>
              <Text style={styles.teslaLabel}>Tesla</Text>
              <Switch
                value={isTesla}
                onValueChange={setIsTesla}
                trackColor={{ false: colors.track, true: colors.orange }}
                thumbColor={colors.onAccent}
              />
            </View>
            <PrimaryButton label={busy ? 'Saving…' : 'Save vehicle'} onPress={onSave} disabled={busy} />
            {error ? <ErrorText>{error}</ErrorText> : null}
          </Card>
        )}
        {!user ? (
          <View style={{ marginTop: 16 }}>
            <PrimaryButton
              label="Sign in"
              onPress={() => {
                setAuthNext('/carpool/add-vehicle')
                router.push('/sign-in')
              }}
            />
          </View>
        ) : null}
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
    copy: { marginTop: 8, color: colors.inkSecondary, fontSize: 15, lineHeight: 22 },
    seatLabel: { fontSize: 12, fontWeight: '700' as const, color: colors.ink, marginBottom: 8 },
    stepper: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 16, marginBottom: 16 },
    stepBtn: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: colors.purpleSoft,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    stepBtnText: { fontSize: 22, fontWeight: '700' as const, color: colors.link },
    seatCount: { fontSize: 22, fontWeight: '800' as const, color: colors.ink, minWidth: 24, textAlign: 'center' as const },
    tesla: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, marginBottom: 12 },
    teslaLabel: { fontWeight: '700' as const, color: colors.ink, fontSize: 15 },
  }
}
