import { useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Pill } from '@/components/Button'
import { CampusMap } from '@/components/CampusMap'
import { MainTabs } from '@/components/MainTabs'
import { loadBusySpots, type BusySpot } from '@/lib/busySpots'
import { useAuth } from '@/lib/auth'
import { displayFirstName } from 'rides-native/authErrors'
import { HEAT_WINDOWS, INK, INK_SECONDARY, ORANGE, PURPLE, SHORTCUTS, SURFACE } from 'rides-native/places.js'

export default function RiderHome() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user, configured } = useAuth()
  const [query, setQuery] = useState('')
  const [showBusy, setShowBusy] = useState(true)
  const [heatWindow, setHeatWindow] = useState('now')
  const [spots, setSpots] = useState<BusySpot[]>([])
  const [caption, setCaption] = useState('Popular campus spots from ride requests — dorms, downtown, stadium.')
  const [blended, setBlended] = useState(false)

  const name = user
    ? displayFirstName(user.user_metadata?.full_name || user.email?.split('@')[0], 'Tiger')
    : 'Tiger'

  useEffect(() => {
    let alive = true
    loadBusySpots(heatWindow).then((result) => {
      if (!alive) return
      setSpots(result.spots)
      setCaption(result.caption)
      setBlended(result.blended)
    })
    return () => {
      alive = false
    }
  }, [heatWindow])

  const goSearch = (dest?: string) => {
    router.push({ pathname: '/confirm', params: { dest: dest || query || 'GSP Airport' } })
  }

  return (
    <View style={styles.screen}>
      <CampusMap spots={spots} showHeat={showBusy} />
      <View pointerEvents="box-none" style={styles.overlay}>
        <View style={[styles.topBar, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
          <View style={styles.brand}>
            <Text style={styles.brandKicker}>RIDE • GAME • REPEAT</Text>
            <Text style={styles.brandTitle}>Clemson <Text style={styles.brandSoft}>RIDES</Text></Text>
            <View style={styles.brandPill}>
              <Text style={styles.brandPillText}>TIGERS GET YOU THERE</Text>
            </View>
          </View>
          <View style={styles.guestChip}>
            <Text style={styles.guestText}>{user ? 'Signed in' : 'Browsing as guest'}</Text>
          </View>
        </View>

        <View style={styles.sheetWrap} pointerEvents="box-none">
          <View style={styles.sheet}>
            <ScrollView style={styles.sheetScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.welcome}>Welcome, {name}</Text>
              <Text style={styles.prompt}>Where are you headed, Tiger?</Text>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Campus, GSP, CLT…"
                placeholderTextColor="#8B939E"
                style={styles.search}
                autoCorrect={false}
              />
              <Pressable onPress={() => goSearch()} style={styles.searchLink}>
                <Text style={styles.searchLinkText}>Search destination →</Text>
              </Pressable>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                <Pill label="🕐  Schedule a ride" onPress={() => router.push('/schedule')} />
                <Pill label="👥  Carpool · split the surge" onPress={() => router.push('/friends')} />
                <Pill label="🧾  Your rides" onPress={() => router.push('/history')} />
              </ScrollView>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shortcuts}>
                {SHORTCUTS.map((shortcut) => (
                  <Pressable key={shortcut.id} onPress={() => goSearch(shortcut.sub)} style={styles.shortcut}>
                    <Text style={styles.shortcutIcon}>{shortcut.icon}</Text>
                    <Text style={styles.shortcutLabel}>{shortcut.label}</Text>
                    <Text style={styles.shortcutSub}>{shortcut.sub}</Text>
                  </Pressable>
                ))}
              </ScrollView>

              <View style={styles.mapCard}>
                <View style={styles.mapHead}>
                  <Text style={styles.mapTitle}>Campus map</Text>
                  <Pressable onPress={() => setShowBusy((value) => !value)} style={[styles.busy, showBusy && styles.busyOn]}>
                    <Text style={[styles.busyText, showBusy && styles.busyTextOn]}>
                      {showBusy ? 'Busy Areas · On' : 'Busy Areas · Off'}
                    </Text>
                  </Pressable>
                </View>
                {showBusy ? (
                  <>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                      {HEAT_WINDOWS.map((window) => (
                        <Pill
                          key={window.id}
                          label={window.label}
                          active={heatWindow === window.id}
                          onPress={() => setHeatWindow(window.id)}
                        />
                      ))}
                    </ScrollView>
                    <Text style={styles.caption}>
                      {caption}
                      {blended ? <Text style={styles.live}>  Live + typical</Text> : null}
                    </Text>
                  </>
                ) : null}
              </View>

              {!configured ? (
                <Text style={styles.keys}>
                  This build needs EXPO_PUBLIC_SUPABASE_ANON_KEY as an EAS environment variable before sign-in works.
                </Text>
              ) : null}

              <Pressable onPress={() => router.push('/friends')} style={styles.gameday}>
                <Text style={styles.gamedayIcon}>🏈</Text>
                <View style={styles.gamedayCopy}>
                  <Text style={styles.gamedayTitle}>Game day carpool</Text>
                  <Text style={styles.gamedayBody}>About $10–$15 each instead of $30–$40.</Text>
                </View>
                <View style={styles.gamedayBtn}>
                  <Text style={styles.gamedayBtnText}>Find a carpool</Text>
                </View>
              </Pressable>
            </ScrollView>
          </View>
          <MainTabs active="home" />
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: SURFACE },
  overlay: { ...StyleSheet.absoluteFill, justifyContent: 'space-between' },
  topBar: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  brand: {
    alignSelf: 'flex-start',
    width: '52%',
    maxWidth: 220,
    minHeight: 96,
    borderRadius: 18,
    backgroundColor: ORANGE,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    justifyContent: 'flex-end',
    shadowColor: ORANGE,
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  brandKicker: { color: '#fff', fontSize: 9, fontWeight: '700', letterSpacing: 1.4, marginBottom: 4 },
  brandTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  brandSoft: { fontWeight: '700' },
  brandPill: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.32)',
  },
  brandPillText: { color: '#fff', fontSize: 9, fontWeight: '700', letterSpacing: 0.4 },
  guestChip: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 4,
  },
  guestText: { color: PURPLE, fontSize: 11, fontWeight: '700' },
  sheetWrap: { height: '64%' },
  sheet: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 18,
    shadowColor: PURPLE,
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -6 },
  },
  sheetScroll: { flex: 1 },
  welcome: { fontSize: 24, fontWeight: '600', letterSpacing: -0.4, color: INK },
  prompt: { color: INK_SECONDARY, fontSize: 15, marginTop: 4, marginBottom: 12 },
  search: {
    borderWidth: 1.5,
    borderColor: ORANGE,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: INK,
    backgroundColor: '#fff',
  },
  searchLink: { paddingVertical: 10 },
  searchLinkText: { color: ORANGE, fontWeight: '700', fontSize: 13 },
  row: { gap: 8, paddingVertical: 4 },
  shortcuts: { gap: 10, paddingTop: 10 },
  shortcut: {
    minWidth: 118,
    padding: 14,
    borderRadius: 16,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(82,45,128,0.14)',
  },
  shortcutIcon: { fontSize: 22, marginBottom: 8 },
  shortcutLabel: { fontWeight: '600', fontSize: 13, color: INK },
  shortcutSub: { fontSize: 11, color: '#8B939E', marginTop: 2 },
  mapCard: { marginTop: 16, paddingBottom: 4 },
  mapHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 },
  mapTitle: { fontWeight: '700', fontSize: 15, color: INK },
  busy: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: 'rgba(82,45,128,0.08)' },
  busyOn: { backgroundColor: PURPLE },
  busyText: { color: PURPLE, fontSize: 12, fontWeight: '700' },
  busyTextOn: { color: '#fff' },
  caption: { color: INK_SECONDARY, fontSize: 12, marginTop: 8, marginBottom: 4, lineHeight: 17 },
  live: { color: PURPLE, fontWeight: '700' },
  keys: { color: '#B42318', fontSize: 12, marginTop: 8, lineHeight: 17 },
  gameday: {
    marginTop: 14,
    marginBottom: 16,
    borderRadius: 18,
    padding: 14,
    backgroundColor: 'rgba(245,102,0,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  gamedayIcon: { fontSize: 24 },
  gamedayCopy: { flex: 1 },
  gamedayTitle: { fontWeight: '700', fontSize: 15, color: INK },
  gamedayBody: { fontSize: 13, color: INK_SECONDARY, marginTop: 2 },
  gamedayBtn: { backgroundColor: PURPLE, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
  gamedayBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
})
