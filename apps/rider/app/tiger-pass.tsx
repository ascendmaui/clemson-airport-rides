import { useFocusEffect, useRouter } from 'expo-router'
import * as Linking from 'expo-linking'
import * as WebBrowser from 'expo-web-browser'
import { useCallback, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Pill, PrimaryButton } from '@/components/Button'
import { RequireAuth } from '@/components/RequireAuth'
import { StackHeader } from '@/components/StackHeader'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'
import { parseCheckoutSessionId } from 'rides-native/checkoutReturn.js'
import { fetchDriversByIds, type OnlineDriver } from 'rides-native/drivers'
import {
  cancelTigerPass,
  confirmTigerPass,
  loadTigerPass,
  saveTigerPassPreferences,
  setFavoriteDrivers,
  startTigerPassCheckout,
  TIGER_PASS_NAME,
  type TigerPassStatus,
} from 'rides-native/tigerPassClient'

function TigerPassScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [status, setStatus] = useState<TigerPassStatus | null>(null)
  const [drivers, setDrivers] = useState<OnlineDriver[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    if (!user || !supabase) return undefined
    let alive = true
    loadTigerPass(supabase).then(async (next) => {
      if (!alive) return
      setStatus(next)
      const ids = next.favoriteDriverIds || []
      const cards = ids.length ? await fetchDriversByIds(supabase, ids) : { drivers: [] as OnlineDriver[] }
      if (!alive) return
      setDrivers(cards.drivers || [])
    }).catch((err: unknown) => {
      if (alive) setNote(err instanceof Error ? err.message : 'Could not load the pass')
    })
    return () => {
      alive = false
    }
  }, [user])

  useFocusEffect(load)

  async function persist(nextCarTypes: string[], nextPreferred: string[]) {
    if (!supabase || !status) return
    setBusy(true)
    setNote(null)
    try {
      const saved = await saveTigerPassPreferences(supabase, {
        preferredCarTypes: nextCarTypes,
        preferredDriverIds: nextPreferred,
      })
      setStatus(saved)
      if (saved.demoDriversIgnored) setNote(saved.demoNote)
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Could not save preferences')
    } finally {
      setBusy(false)
    }
  }

  async function onSubscribe() {
    if (!supabase || busy) return
    setBusy(true)
    setNote(null)
    try {
      const returnUrl = Linking.createURL('tiger-pass')
      const session = await startTigerPassCheckout(supabase, {
        successUrl: `${returnUrl}?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: returnUrl,
      })
      if (!session.url) {
        setNote('Checkout did not open. No charge was made.')
        return
      }
      const result = await WebBrowser.openAuthSessionAsync(session.url, returnUrl)
      if (result.type !== 'success') {
        setNote('Checkout canceled. No charge was made.')
        return
      }
      const sessionId = parseCheckoutSessionId(result.url)
      if (!sessionId) {
        setNote('Stripe did not return a session. No pass was started.')
        return
      }
      const confirmed = await confirmTigerPass(supabase, sessionId)
      setStatus(confirmed)
      setNote(confirmed.active ? `${confirmed.name} is active.` : 'Payment is still processing.')
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Could not start checkout. No charge was made.')
    } finally {
      setBusy(false)
    }
  }

  async function onCancel() {
    if (!supabase || busy) return
    setBusy(true)
    setNote(null)
    try {
      const next = await cancelTigerPass(supabase)
      setStatus(next)
      setNote(next.cancelAtPeriodEnd ? `${next.name} ends at the close of this period.` : `${next.name} is canceled.`)
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Could not cancel')
    } finally {
      setBusy(false)
    }
  }

  async function onUnfavorite(driverId: string) {
    if (!supabase || !status) return
    const next = status.favoriteDriverIds.filter((id) => id !== driverId)
    setBusy(true)
    try {
      const saved = await setFavoriteDrivers(supabase, next)
      setStatus(saved)
      setDrivers((rows) => rows.filter((driver) => saved.favoriteDriverIds.includes(driver.id)))
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Could not update favorites')
    } finally {
      setBusy(false)
    }
  }

  const name = status?.name || TIGER_PASS_NAME
  const carTypes = status?.carTypes || []
  const selectedCars = status?.preferredCarTypes || []
  const preferred = new Set(status?.preferredDriverIds || [])

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StackHeader title={name} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.kicker}>{status?.active ? 'ACTIVE' : 'FREQUENT RIDER'}</Text>
        <Text style={styles.title}>{name}</Text>
        <Text style={styles.copy}>{status?.summary || 'A monthly pass for frequent riders.'}</Text>
        <Text style={styles.copy}>{status?.priceLabel} · {status?.discountPct || 10}% off Standard, Wait & Save, and Extra Comfort.</Text>
        {status?.active ? <Text style={styles.badge}>Discount is on</Text> : <Text style={styles.copy}>The discount starts after checkout.</Text>}
        {status?.currentPeriodEnd ? <Text style={styles.copy}>Current period ends {new Date(status.currentPeriodEnd).toLocaleDateString()}</Text> : null}
        {status?.active ? (
          <PrimaryButton label={busy ? 'Working…' : 'Cancel pass'} onPress={onCancel} disabled={busy} tone="ghost" />
        ) : (
          <PrimaryButton label={busy ? 'Opening…' : `Subscribe · ${status?.priceLabel || ''}`} onPress={onSubscribe} disabled={busy} />
        )}

        <View style={[styles.card, lift(colors, 'rest')]}>
          <Text style={styles.rowTitle}>Preferred ride types</Text>
          <Text style={styles.copy}>Choose among Standard, Wait & Save, and Extra Comfort. Other ride types are not offered.</Text>
          <View style={styles.pills}>
            {carTypes.map((car) => (
              <Pill
                key={car.id}
                label={car.name}
                active={selectedCars.includes(car.id)}
                onPress={() => {
                  const next = selectedCars.includes(car.id)
                    ? selectedCars.filter((id) => id !== car.id)
                    : [...selectedCars, car.id]
                  void persist(next, status?.preferredDriverIds || [])
                }}
              />
            ))}
          </View>
        </View>

        <View style={[styles.card, lift(colors, 'rest')]}>
          <Text style={styles.rowTitle}>Favorite drivers</Text>
          <Text style={styles.copy}>{status?.demoNote}</Text>
          <Text style={styles.copy}>
            {status?.active
              ? `Preferred drivers are offered first while ${name} is active. Other favorites come next.`
              : 'Favorites are offered before the open pool. Preferred drivers move ahead of other favorites while the pass is active.'}
          </Text>
          {drivers.length === 0 ? <Text style={styles.copy}>No favorite drivers yet. Save one from Pick a driver.</Text> : null}
          {drivers.map((driver) => {
            const on = preferred.has(driver.id)
            return (
              <View key={driver.id} style={styles.driverRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{driver.name}</Text>
                  <Text style={styles.copy}>{driver.vehicleLabel}</Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={on ? `Remove ${driver.name} from preferred drivers` : `Prefer ${driver.name}`}
                  onPress={() => {
                    const next = on
                      ? (status?.preferredDriverIds || []).filter((id) => id !== driver.id)
                      : [...(status?.preferredDriverIds || []), driver.id]
                    void persist(selectedCars, next)
                  }}
                >
                  <Text style={on ? styles.badge : styles.link}>{on ? 'Preferred' : 'Prefer'}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${driver.name} from favorites`} onPress={() => { void onUnfavorite(driver.id) }}>
                  <Text style={styles.link}>Remove</Text>
                </Pressable>
              </View>
            )
          })}
          <PrimaryButton label="Pick a driver" tone="purple" onPress={() => router.push('/')} />
        </View>
        {note ? <Text style={styles.note}>{note}</Text> : null}
      </ScrollView>
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 20, gap: 12, paddingBottom: 40 },
    kicker: { color: colors.orange, fontWeight: '800' as const, letterSpacing: 1.1, fontSize: 12 },
    title: { color: colors.title, fontSize: 28, fontWeight: '800' as const },
    copy: { color: colors.inkSecondary, fontSize: 14, lineHeight: 20 },
    badge: { color: colors.link, fontWeight: '800' as const },
    link: { color: colors.link, fontWeight: '700' as const, fontSize: 13 },
    note: { color: colors.link, fontSize: 13, lineHeight: 18 },
    card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, gap: 8 },
    rowTitle: { color: colors.title, fontWeight: '800' as const, fontSize: 16 },
    pills: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
    driverRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingVertical: 8 },
  }
}

export default function TigerPassRoute() {
  return (
    <RequireAuth>
      <TigerPassScreen />
    </RequireAuth>
  )
}
