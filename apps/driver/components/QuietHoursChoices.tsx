import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Card, ErrorText } from '@/components/chrome'
import { Toggle } from '@/components/shell'
import { useAuth } from '@/lib/auth'
import { saveDriverQuiet, useDriverAlertPrefs } from '@/lib/quietHours'
import { useTheme } from '@/lib/theme'
import { formatHhmm, hhmmLabel, isQuietAt, parseHhmm } from '../../../shared/quietWindow.js'

const STEP = 30

function TimeStepper({ label, value, onChange }: { label: string; value: string; onChange: (next: string) => void }) {
  const { colors } = useTheme()
  const mins = parseHhmm(value) ?? 0
  const shift = (delta: number) => onChange(formatHhmm(mins + delta))
  return (
    <View style={styles.stepper}>
      <Text style={{ color: colors.inkSecondary, fontWeight: '700' }}>{label}</Text>
      <View style={styles.stepRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label} 30 minutes earlier`} onPress={() => shift(-STEP)} style={[styles.stepBtn, { backgroundColor: colors.track }]}>
          <Text style={{ color: colors.title, fontSize: 20, fontWeight: '800' }}>−</Text>
        </Pressable>
        <Text accessibilityLabel={`${label} ${hhmmLabel(value)}`} style={{ color: colors.title, fontSize: 20, fontWeight: '800', minWidth: 110, textAlign: 'center' }}>{hhmmLabel(value)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label} 30 minutes later`} onPress={() => shift(STEP)} style={[styles.stepBtn, { backgroundColor: colors.track }]}>
          <Text style={{ color: colors.title, fontSize: 20, fontWeight: '800' }}>+</Text>
        </Pressable>
      </View>
    </View>
  )
}

/**
 * Account > Settings > Quiet hours. Saved to profiles.notification_prefs.quiet,
 * so the server's offer push follows the same window. Clemson time.
 */
export function QuietHoursChoices() {
  const { user } = useAuth()
  const { colors } = useTheme()
  const prefs = useDriverAlertPrefs(user?.id)
  const [quiet, setQuiet] = useState(prefs?.quiet ?? null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => { if (prefs) setQuiet(prefs.quiet) }, [prefs])
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(timer)
  }, [])

  async function update(patch: Partial<NonNullable<typeof quiet>>) {
    if (!user?.id || !quiet) return
    const next = { ...quiet, ...patch }
    setQuiet(next)
    setError(null)
    try {
      const result = await saveDriverQuiet(user.id, next)
      if (!result.persisted) setError(`Saved on this phone only${result.softFail ? ` (${result.softFail})` : ''}. Offer pushes from the server may still sound until it syncs.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save quiet hours')
    }
  }

  if (!quiet) return <Text style={{ color: colors.inkSecondary }}>Loading quiet hours…</Text>
  const quietNow = isQuietAt(quiet, now)
  const crossesMidnight = (parseHhmm(quiet.start) ?? 0) > (parseHhmm(quiet.end) ?? 0)

  return (
    <Card>
      <View style={styles.row}>
        <Text style={{ color: colors.ink, fontWeight: '800', flex: 1 }}>Quiet hours</Text>
        <Toggle on={quiet.scheduleEnabled} onPress={() => { void update({ scheduleEnabled: !quiet.scheduleEnabled }) }} label="Quiet hours" />
      </View>
      <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
        During quiet hours new ride offers make no sound, no vibration, and no push. Offers still appear silently in the app, and the heat map, cash out, and chat work as usual. Clemson time (Eastern).
      </Text>
      {quiet.scheduleEnabled ? (
        <>
          <TimeStepper label="Start" value={quiet.start} onChange={(start) => { void update({ start }) }} />
          <TimeStepper label="End" value={quiet.end} onChange={(end) => { void update({ end }) }} />
          <Text accessibilityLiveRegion="polite" style={{ color: quietNow ? colors.orange : colors.inkSecondary, fontWeight: '700' }}>
            {quiet.start === quiet.end
              ? 'Start and end match, so offers are silent all day.'
              : `${quietNow ? 'Quiet now' : 'Not quiet now'} · ${hhmmLabel(quiet.start)} to ${hhmmLabel(quiet.end)}${crossesMidnight ? ' (overnight)' : ''}`}
          </Text>
        </>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </Card>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepper: { gap: 6, marginTop: 8 },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
})
