import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { ScrollView, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PrimaryButton } from '@/components/Button'
import { StackHeader } from '@/components/StackHeader'
import { RequireAuth } from '@/components/RequireAuth'
import { supabase } from '@/lib/supabase'
import type { Palette } from '@/lib/palette'
import { useThemedStyles } from '@/lib/useThemedStyles'
import {
  COVERED_LABEL, PLAN_BADGE_COLOR, WEEKEND_CARPOOL_PLAN, cancelStudentPlan, formatUsd, loadStudentPlans,
  pauseStudentPlan, requestStudentCode, resumeStudentPlan, subscribeStudentPlan, verifyStudentCode,
} from 'rides-native/studentPlansClient.js'

function hourLabel(h: number) {
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 === 0 ? 12 : h % 12} ${ampm}`
}

function StudentPlansScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const styles = useThemedStyles(makeStyles)
  const [data, setData] = useState<any>(null)
  const [code, setCode] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    let alive = true
    if (!supabase) return undefined
    loadStudentPlans(supabase).then((d: any) => { if (alive) setData(d) }).catch((e: any) => setNote(e?.message || 'Could not load plans'))
    return () => { alive = false }
  }, [])
  useFocusEffect(load)

  async function run(fn: () => Promise<any>, ok: string) {
    setBusy(true)
    setNote(null)
    try {
      await fn()
      setNote(ok)
      load()
    } catch (e: any) {
      setNote(e?.message || 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  if (data && data.enabled === false) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <StackHeader title="Student plans" onBack={() => router.back()} />
        <View style={styles.body}><Text style={styles.copy}>Student plans are not available yet.</Text></View>
      </View>
    )
  }

  const v = data?.verification
  const sub = data?.subscription
  const quote = data?.quote
  const win = data?.plans?.weekendCarpool?.window || { startHour: 18, endHour: 4 }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StackHeader title="Student plans" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.badge, { backgroundColor: PLAN_BADGE_COLOR }]}>Clemson Rides · Student</Text>

        {!v?.emailVerified ? (
          <View style={styles.panel}>
            <Text style={styles.state}>Verify your clemson.edu email</Text>
            <Text style={styles.copy}>{v?.email || 'No email'} · re-verified each semester ({v?.term})</Text>
            <PrimaryButton label={busy ? 'Sending…' : 'Send code'} onPress={() => run(() => requestStudentCode(supabase), 'Code requested.')} disabled={busy || !v?.clemsonEmail} />
            <TextInput value={code} onChangeText={setCode} placeholder="6-digit code" keyboardType="number-pad" maxLength={6} style={styles.input} accessibilityLabel="Verification code" />
            <PrimaryButton label="Verify" onPress={() => run(() => verifyStudentCode(supabase, code), 'Email verified.')} disabled={busy || code.length !== 6} tone="purple" />
          </View>
        ) : (
          <Text style={styles.copy}>
            Email verified · enrollment {v?.registrarStatus === 'verified' ? 'confirmed' : 'pending review'} for {v?.term}
          </Text>
        )}

        {quote?.quoted_plan ? (
          <View style={styles.panel}>
            <Text style={styles.state}>Your best plan</Text>
            <Text style={styles.copy}>{quote.summary}</Text>
            <Text style={styles.big}>You would have spent {formatUsd(quote.retail_monthly_cents)}, your plan is {formatUsd(quote.monthly_cents)}</Text>
            {!sub ? <PrimaryButton label="Start free week" onPress={() => run(() => subscribeStudentPlan(supabase, quote.quoted_plan, 'month'), 'Your free week started.')} disabled={busy} /> : null}
          </View>
        ) : null}

        <View style={styles.panel}>
          <Text style={styles.state}>{WEEKEND_CARPOOL_PLAN.name}</Text>
          <Text style={styles.big}>{formatUsd(WEEKEND_CARPOOL_PLAN.monthlyCents)}/mo · school months only</Text>
          <Text style={styles.copy}>Or {formatUsd(WEEKEND_CARPOOL_PLAN.semesterCents)} a semester (15% off). Best value: 4 years for {formatUsd(WEEKEND_CARPOOL_PLAN.fourYearAnchorCents)}.</Text>
          <Text style={styles.copy}>Matched carpools with 2+ riders, Friday and Saturday nights {hourLabel(win.startHour)}–{hourLabel(win.endHour)}. Surge covered up to 1.2x; you pay anything above. 7-day free trial, card on file.</Text>
          {!sub ? (
            <>
              <PrimaryButton label="Start free week · monthly" onPress={() => run(() => subscribeStudentPlan(supabase, 'weekend_carpool', 'month'), 'Your free week started.')} disabled={busy || !v?.emailVerified} />
              <PrimaryButton label="Semester prepay" onPress={() => run(() => subscribeStudentPlan(supabase, 'weekend_carpool', 'semester'), 'Subscribed.')} disabled={busy || !v?.emailVerified} tone="ghost" />
            </>
          ) : null}
        </View>

        {sub ? (
          <View style={styles.panel}>
            <Text style={styles.state}>Your plan · {sub.status}</Text>
            {sub.trialEndsAt ? <Text style={styles.copy}>Free week ends {new Date(sub.trialEndsAt).toLocaleDateString()}</Text> : null}
            <Text style={styles.copy}>Plan clock: {sub.clockDays} active days</Text>
            {sub.status === 'paused' ? (
              <PrimaryButton label="Resume" onPress={() => run(() => resumeStudentPlan(supabase), 'Resumed.')} disabled={busy} />
            ) : (
              (data?.pauseWindows || []).map((w: any) => (
                <PrimaryButton key={`${w.kind}-${w.start}`} label={`Pause for ${w.label}`} tone="ghost" disabled={busy}
                  onPress={() => run(() => pauseStudentPlan(supabase, w.kind, w.start, w.end), `Paused ${w.start} to ${w.end}.`)} />
              ))
            )}
            {!sub.cancelAtPeriodEnd ? <PrimaryButton label="Cancel plan" tone="ghost" onPress={() => run(() => cancelStudentPlan(supabase), 'Plan ends at the end of this period.')} disabled={busy} /> : null}
            <Text style={styles.copy}>Leave of absence? Contact support to pause billing and the clock.</Text>
          </View>
        ) : null}

        {(data?.recentFares || []).length ? (
          <View style={styles.panel}>
            <Text style={styles.state}>Recent rides</Text>
            {data.recentFares.map((f: any) => (
              <Text key={f.tripId} style={styles.copy}>
                {f.at ? new Date(f.at).toLocaleDateString() : ''} · {f.covered ? (f.label || COVERED_LABEL) : formatUsd(f.fareCents)}
              </Text>
            ))}
          </View>
        ) : null}
        {note ? <Text style={styles.note}>{note}</Text> : null}
      </ScrollView>
    </View>
  )
}

function makeStyles(colors: Palette) {
  return {
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 20, gap: 12 },
    badge: { alignSelf: 'flex-start' as const, color: '#FFFFFF', fontWeight: '800' as const, fontSize: 12, letterSpacing: 1, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, overflow: 'hidden' as const },
    panel: { backgroundColor: colors.orangeSoft, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.orange, gap: 8 },
    state: { color: colors.title, fontWeight: '800' as const, fontSize: 18 },
    big: { color: colors.title, fontWeight: '700' as const, fontSize: 16 },
    copy: { color: colors.inkSecondary, fontSize: 14, lineHeight: 20 },
    note: { color: colors.link, fontSize: 13, lineHeight: 18 },
    input: { borderWidth: 1, borderColor: colors.orange, borderRadius: 10, padding: 10, color: colors.title, fontSize: 18, letterSpacing: 4 },
  }
}

export default function StudentPlansRoute() {
  return (
    <RequireAuth>
      <StudentPlansScreen />
    </RequireAuth>
  )
}
