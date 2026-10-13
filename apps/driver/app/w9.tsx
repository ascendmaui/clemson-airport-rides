import { useRouter, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { Card, ErrorText, Field, Primary } from '@/components/chrome'
import { StackPage } from '@/components/shell'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { loadDriverW9, saveDriverW9Record } from 'rides-native/driverW9Client'
import { TAX_CLASSIFICATIONS } from 'rides-native/driverOnboardingClient'
import { w9FormIssue, w9StatusLabel } from '../../../shared/driverW9.js'

type TinKind = 'ssn' | 'ein'

function todayDate() {
  const date = new Date()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export default function W9Screen() {
  const router = useRouter()
  const { user } = useAuth()
  const { colors } = useTheme()
  const [legalName, setLegalName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [taxClass, setTaxClass] = useState(TAX_CLASSIFICATIONS[0]?.id || 'individual')
  const [address, setAddress] = useState('')
  const [tinKind, setTinKind] = useState<TinKind>('ssn')
  const [tin, setTin] = useState('')
  const [certified, setCertified] = useState(false)
  const [signature, setSignature] = useState('')
  const [signedOn, setSignedOn] = useState(todayDate())
  const [statusText, setStatusText] = useState('Not on file')
  const [stripeConnect, setStripeConnect] = useState(false)
  const [updateUrl, setUpdateUrl] = useState<string | null>(null)
  const [ready, setReady] = useState(!user)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!user || !supabase) return
    const desk = await loadDriverW9(supabase, user.id)
    setStripeConnect(desk.stripeConnect)
    setUpdateUrl(desk.updateUrl)
    setStatusText(w9StatusLabel(desk))
    const status = desk.status
    if (status?.legalName) setLegalName(status.legalName)
    if (status?.businessName) setBusinessName(status.businessName)
    if (status?.taxClassification) setTaxClass(status.taxClassification)
    if (status?.address) setAddress(status.address)
    if (status?.tinKind === 'ssn' || status?.tinKind === 'ein') setTinKind(status.tinKind)
    if (status?.signatureName) setSignature(status.signatureName)
    if (status?.signedOn) setSignedOn(status.signedOn)
    if (status?.certified) setCertified(true)
    setTin('')
  }, [user])

  useFocusEffect(useCallback(() => {
    if (!user) {
      setReady(true)
      return undefined
    }
    let alive = true
    refresh()
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'Could not load your W-9')
      })
      .finally(() => {
        if (alive) setReady(true)
      })
    return () => {
      alive = false
    }
  }, [refresh, user]))

  function openStripe() {
    if (!updateUrl) return
    Linking.openURL(updateUrl).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Could not open Stripe')
    })
  }

  async function save() {
    if (!supabase) return
    const issue = w9FormIssue({
      legalName,
      businessName,
      taxClassification: taxClass,
      address,
      tin,
      tinKind,
      certified,
      signatureName: signature,
      signedOn,
    })
    if (issue) {
      setError(issue)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const saved = await saveDriverW9Record(supabase, {
        legalName,
        businessName,
        taxClassification: taxClass,
        address,
        tin,
        tinKind,
        certified: true,
        signatureName: signature,
        signedOn,
      })
      setTin('')
      setStatusText(w9StatusLabel({ status: saved }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the W-9')
    } finally {
      setBusy(false)
    }
  }

  const showLocalForm = !stripeConnect

  return (
    <StackPage title="W-9" onBack={() => router.back()}>
      <Card>
        <Text style={{ color: colors.title, fontWeight: '800' }}>Tax info</Text>
        <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>{ready ? statusText : 'Loading W-9 status'}</Text>
      </Card>
      {!user ? (
        <Card>
          <Text style={{ color: colors.title, fontWeight: '800' }}>Sign in to update your W-9</Text>
          <Primary label="Sign in" onPress={() => router.push('/sign-in')} />
        </Card>
      ) : null}
      {user && !ready ? (
        <Card>
          <Text style={{ color: colors.title, fontWeight: '800' }}>Loading W-9</Text>
        </Card>
      ) : null}
      {user && ready && stripeConnect ? (
        <Card>
          <Text style={{ color: colors.title, fontWeight: '800' }}>Update tax info in Stripe</Text>
          <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
            This payout account is on Stripe Connect. Tax classification and the taxpayer identification number are collected on Stripe’s hosted page, so the full number is not stored in this app.
          </Text>
          <Primary
            label={updateUrl ? 'Open Stripe tax info' : 'Stripe link unavailable'}
            onPress={openStripe}
            disabled={!updateUrl}
            accessibilityLabel="Open Stripe tax info"
          />
        </Card>
      ) : null}
      {user && ready && showLocalForm ? (
        <Card>
          <Text style={{ color: colors.title, fontWeight: '800' }}>W-9</Text>
          <Text style={{ color: colors.inkSecondary, lineHeight: 20 }}>
            This is not tax advice. The full TIN is encrypted before it is stored. After you save, this screen shows only the last four.
          </Text>
          <Field label="Legal name" value={legalName} onChangeText={setLegalName} />
          <Field label="Business name" value={businessName} onChangeText={setBusinessName} placeholder="Optional" />
          <Text style={{ color: colors.inkSecondary, fontSize: 13, fontWeight: '700' }}>Federal tax classification</Text>
          <View style={styles.choices}>
            {TAX_CLASSIFICATIONS.map((item) => {
              const on = taxClass === item.id
              return (
                <Pressable
                  key={item.id}
                  onPress={() => setTaxClass(item.id)}
                  accessibilityRole="radio"
                  accessibilityLabel={item.label}
                  accessibilityState={{ selected: on }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={[styles.choice, { borderColor: colors.border, backgroundColor: on ? colors.purple : colors.card }]}
                >
                  <Text style={{ color: on ? colors.onAccent : colors.ink, fontWeight: '700' }}>{item.label}</Text>
                </Pressable>
              )
            })}
          </View>
          <Field label="Address" value={address} onChangeText={setAddress} />
          <Text style={{ color: colors.inkSecondary, fontSize: 13, fontWeight: '700' }}>TIN (SSN or EIN)</Text>
          <View style={styles.kindRow}>
            <KindChoice label="SSN" selected={tinKind === 'ssn'} onPress={() => setTinKind('ssn')} />
            <KindChoice label="EIN" selected={tinKind === 'ein'} onPress={() => setTinKind('ein')} />
          </View>
          <Field
            label={tinKind === 'ein' ? 'EIN' : 'SSN'}
            value={tin}
            onChangeText={setTin}
            secure
            keyboard="number-pad"
            placeholder="9 digits"
          />
          <Pressable
            onPress={() => setCertified((value) => !value)}
            accessibilityRole="checkbox"
            accessibilityLabel="I certify that this W-9 information is correct"
            accessibilityState={{ checked: certified }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.checkRow}
          >
            <View style={[styles.box, { borderColor: colors.purple, backgroundColor: certified ? colors.purple : 'transparent' }]} />
            <Text style={{ color: colors.ink, flex: 1, lineHeight: 20 }}>
              I certify that the legal name, federal tax classification, address, and taxpayer identification number are correct, and I sign this W-9 electronically.
            </Text>
          </Pressable>
          <Field label="E-signature" value={signature} onChangeText={setSignature} placeholder="Type your legal name" />
          <Field label="Date" value={signedOn} onChangeText={setSignedOn} placeholder="YYYY-MM-DD" />
          <Primary label={busy ? 'Saving…' : 'Save W-9'} onPress={() => { void save() }} disabled={busy} />
        </Card>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </StackPage>
  )
}

function KindChoice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={[styles.choice, { borderColor: colors.border, backgroundColor: selected ? colors.orange : colors.card }]}
    >
      <Text style={{ color: selected ? colors.onAccent : colors.ink, fontWeight: '800' }}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  choices: { gap: 8 },
  choice: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  kindRow: { flexDirection: 'row', gap: 8 },
  checkRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, marginTop: 2 },
})
