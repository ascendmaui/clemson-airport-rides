import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { RequireAuth } from '@/components/RequireAuth'
import { StackHeader } from '@/components/StackHeader'
import { useAuth } from '@/lib/auth'
import { oneParam } from '@/lib/oneParam'
import { supabase } from '@/lib/supabase'
import { lift } from '@/lib/elevation'
import type { Palette } from '@/lib/palette'
import { useTheme } from '@/lib/theme'
import { useThemedStyles } from '@/lib/useThemedStyles'
import {
  closeLostFoundReport,
  confirmFound,
  confirmNotFound,
  createLostFoundReport,
  fetchLostFoundReport,
  fetchRecentLostFoundTrips,
  listLostFoundReports,
  markReturned,
  sendLostFoundMessage,
  resolutionLabel,
  statusLabel,
} from 'rides-native/lostFoundClient.js'

type TripChoice = {
  id: string
  otherId: string
  otherFirstName: string
  pickup: string
  dropoff: string
}

type ReportRow = {
  id: string
  status: string
  itemDescription: string
  pickup: string
  dropoff: string
  reporterFirstName: string
  counterpartFirstName: string
  mine: boolean
}

function LostFoundScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ trip?: string }>()
  const presetTrip = oneParam(params.trip, '')
  const { user } = useAuth()
  const { colors } = useTheme()
  const styles = useThemedStyles(makeStyles)
  const [reports, setReports] = useState<ReportRow[]>([])
  const [trips, setTrips] = useState<TripChoice[]>([])
  const [tripId, setTripId] = useState(presetTrip)
  const [description, setDescription] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function reload() {
    if (!supabase || !user?.id) return
    const [list, recent] = await Promise.all([
      listLostFoundReports(supabase, user.id),
      fetchRecentLostFoundTrips(supabase, user.id),
    ])
    setReports(list)
    setTrips(recent)
  }

  useEffect(() => {
    let alive = true
    reload().catch((err) => {
      if (alive) setError(err instanceof Error ? err.message : 'Could not load lost and found')
    })
    return () => { alive = false }
  }, [user?.id])

  async function openReport(id: string) {
    if (!supabase || !user?.id) return
    setOpenId(id)
    setError(null)
    try {
      setDetail(await fetchLostFoundReport(supabase, id, user.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the report')
    }
  }

  async function onCreate() {
    if (!supabase || !user?.id) return
    const trip = trips.find((item) => item.id === tripId)
    if (!trip) {
      setError('Pick a completed ride that has a driver.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const created = await createLostFoundReport(supabase, {
        tripId: trip.id,
        reporterId: user.id,
        counterpartId: trip.otherId,
        description,
      })
      setDescription('')
      setNote('Report filed. The other person can confirm whether they have it.')
      await reload()
      if (created?.id) await openReport(created.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not file the report')
    } finally {
      setBusy(false)
    }
  }

  async function act(kind: 'found' | 'missing' | 'returned' | 'close' | 'message') {
    if (!supabase || !user?.id || !openId) return
    setBusy(true)
    setError(null)
    try {
      if (kind === 'found') await confirmFound(supabase, openId)
      if (kind === 'missing') await confirmNotFound(supabase, openId)
      if (kind === 'returned') await markReturned(supabase, openId)
      if (kind === 'close') await closeLostFoundReport(supabase, openId)
      if (kind === 'message') {
        await sendLostFoundMessage(supabase, { reportId: openId, senderId: user.id, body: message })
        setMessage('')
      }
      await openReport(openId)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the report')
    } finally {
      setBusy(false)
    }
  }

  const choices = (detail?.choices || {}) as Record<string, boolean>
  const messages = (detail?.messages || []) as { id: string; body: string; senderFirstName: string }[]

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StackHeader title="Lost & found" onBack={() => (openId ? setOpenId(null) : router.back())} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.copy}>Report an item left in the vehicle after a completed ride. Same reports as the website.</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {note ? <Text style={styles.note}>{note}</Text> : null}
        {openId && detail ? (
          <View style={[styles.card, lift(colors, 'rest')]}>
            <Text style={styles.cardTitle}>{String(detail.itemDescription || 'Item')}</Text>
            <Text style={styles.copy}>
              {statusLabel(detail.status)}{detail.resolution ? ` · ${resolutionLabel(detail.resolution)}` : ''}
            </Text>
            <Text style={styles.copy}>{String(detail.pickup || '')} → {String(detail.dropoff || '')}</Text>
            {messages.map((row) => (
              <Text key={row.id} style={styles.copy}>{row.senderFirstName}: {row.body}</Text>
            ))}
            {choices.canConfirmFound ? <PrimaryButton label="I have it" onPress={() => void act('found')} disabled={busy} /> : null}
            {choices.canConfirmNotFound ? <PrimaryButton label="I do not have it" tone="ghost" onPress={() => void act('missing')} disabled={busy} /> : null}
            {choices.canMarkReturned ? <PrimaryButton label="Mark returned" onPress={() => void act('returned')} disabled={busy} /> : null}
            {choices.canClose ? <PrimaryButton label="Close report" tone="ghost" onPress={() => void act('close')} disabled={busy} /> : null}
            {choices.canMessage ? (
              <>
                <TextInput value={message} onChangeText={setMessage} placeholder="Note about the return" placeholderTextColor={colors.placeholder} style={styles.input} />
                <PrimaryButton label="Send note" tone="purple" onPress={() => void act('message')} disabled={busy || !message.trim()} />
              </>
            ) : null}
          </View>
        ) : (
          <>
            <Text style={styles.heading}>New report</Text>
            {trips.length === 0 ? <Text style={styles.copy}>No completed rides with a driver yet.</Text> : null}
            {trips.map((trip) => (
              <Pressable key={trip.id} accessibilityRole="button" onPress={() => setTripId(trip.id)} style={[styles.card, tripId === trip.id && styles.cardOn, lift(colors, 'rest')]}>
                <Text style={styles.cardTitle}>{trip.otherFirstName}</Text>
                <Text style={styles.copy}>{trip.pickup} → {trip.dropoff}</Text>
              </Pressable>
            ))}
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="What was left behind?"
              placeholderTextColor={colors.placeholder}
              style={styles.input}
            />
            <PrimaryButton label={busy ? 'Filing…' : 'File report'} onPress={() => void onCreate()} disabled={busy} />
            <Text style={styles.heading}>Your reports</Text>
            {reports.length === 0 ? <Text style={styles.copy}>No reports yet.</Text> : null}
            {reports.map((report) => (
              <Pressable key={report.id} accessibilityRole="button" onPress={() => void openReport(report.id)} style={[styles.card, lift(colors, 'rest')]}>
                <Text style={styles.cardTitle}>{report.itemDescription}</Text>
                <Text style={styles.copy}>{statusLabel(report.status)} · {report.mine ? report.counterpartFirstName : report.reporterFirstName}</Text>
                <Text style={styles.copy}>{report.pickup} → {report.dropoff}</Text>
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 16, gap: 10, paddingBottom: 40 },
    copy: { color: colors.inkSecondary, fontSize: 14, lineHeight: 20 },
    heading: { color: colors.title, fontWeight: '800' as const, fontSize: 16, marginTop: 8 },
    card: { backgroundColor: colors.card, borderRadius: 16, padding: 14, gap: 4 },
    cardOn: { borderWidth: 1.5, borderColor: colors.purple },
    cardTitle: { color: colors.ink, fontWeight: '800' as const, fontSize: 16 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 12,
      color: colors.ink,
      backgroundColor: colors.card,
      fontSize: 16,
    },
    note: { color: colors.link, fontWeight: '700' as const },
    error: { color: colors.danger, fontSize: 13 },
  }
}

export default function LostFoundRoute() {
  return (
    <RequireAuth>
      <LostFoundScreen />
    </RequireAuth>
  )
}
