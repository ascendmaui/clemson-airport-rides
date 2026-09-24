import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { StackHeader } from '@/components/StackHeader'
import { useAuth } from '@/lib/auth'
import { authStorage } from '@/lib/storage'
import { supabase } from '@/lib/supabase'
import {
  DEFAULT_NOTIFICATION_PREFS,
  fetchNotificationPrefs,
  NOTIFICATION_CATEGORIES,
  saveNotificationPrefs,
} from 'rides-native/notificationPrefs.js'
import { INK_SECONDARY, ORANGE, PURPLE, SURFACE } from 'rides-native/places.js'

type Prefs = typeof DEFAULT_NOTIFICATION_PREFS

export default function NotificationsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_NOTIFICATION_PREFS)
  const [note, setNote] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    if (!user) return undefined
    let alive = true
    fetchNotificationPrefs(supabase, authStorage, user.id).then((result) => {
      if (!alive) return
      setPrefs(result.prefs as Prefs)
      if (result.softFail) setNote(`Saved on this phone. Profile sync: ${result.softFail}`)
    })
    return () => {
      alive = false
    }
  }, [user])

  useFocusEffect(load)

  async function update(next: Prefs) {
    setPrefs(next)
    if (!user) return
    setSaving(true)
    const result = await saveNotificationPrefs(supabase, authStorage, user.id, next)
    setSaving(false)
    setNote(result.softFail
      ? `Saved on this phone. Profile sync: ${result.softFail}`
      : result.persisted
        ? 'Saved to your account.'
        : 'Saved on this phone.')
  }

  function toggleCategory(id: string) {
    const current = prefs[id as keyof Prefs]
    void update({ ...prefs, [id]: !current })
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StackHeader title="Notifications" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.copy}>Choose which alerts this account keeps. Ride, billing, and promo notices use the same profile field as the web app.</Text>
        {!user ? <PrimaryButton label="Sign in" onPress={() => router.push('/sign-in')} /> : null}
        {NOTIFICATION_CATEGORIES.map((category) => {
          const on = prefs[category.id as keyof Prefs] !== false
          return (
            <View key={category.id} style={[styles.row, on && styles.rowOn]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{category.label}</Text>
                <Text style={styles.copy}>{category.hint}</Text>
              </View>
              <Switch
                value={on}
                onValueChange={() => toggleCategory(category.id)}
                disabled={!user || saving}
                trackColor={{ false: 'rgba(11,18,32,0.15)', true: ORANGE }}
                thumbColor="#fff"
              />
            </View>
          )
        })}
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Do not disturb — new requests</Text>
            <Text style={styles.copy}>Mutes the new-request tone. Mid-ride cancel tones still play.</Text>
          </View>
          <Switch
            value={prefs.dndNewRequestTones}
            onValueChange={(value) => void update({ ...prefs, dndNewRequestTones: value })}
            disabled={!user || saving}
            trackColor={{ false: 'rgba(11,18,32,0.15)', true: ORANGE }}
            thumbColor="#fff"
          />
        </View>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Quiet hours</Text>
            <Text style={styles.copy}>Turns on the same quiet-hours switch stored with these prefs.</Text>
          </View>
          <Switch
            value={prefs.quiet.dnd}
            onValueChange={(value) => void update({ ...prefs, quiet: { ...prefs.quiet, dnd: value } })}
            disabled={!user || saving}
            trackColor={{ false: 'rgba(11,18,32,0.15)', true: ORANGE }}
            thumbColor="#fff"
          />
        </View>
        {note ? <Text style={styles.note}>{note}</Text> : null}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SURFACE },
  body: { padding: 20, gap: 10, paddingBottom: 32 },
  copy: { color: INK_SECONDARY, fontSize: 13, lineHeight: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(82,45,128,0.1)',
  },
  rowOn: { backgroundColor: 'rgba(82,45,128,0.06)', borderColor: 'rgba(82,45,128,0.28)' },
  rowTitle: { color: PURPLE, fontWeight: '800', fontSize: 15, marginBottom: 2 },
  note: { color: PURPLE, fontSize: 13, lineHeight: 18 },
})
