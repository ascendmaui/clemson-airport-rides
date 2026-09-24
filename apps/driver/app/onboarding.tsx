import { useRouter } from 'expo-router'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BackButton, Card, ErrorText, Field, Primary, Tag } from '@/components/chrome'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import {
  ONBOARDING_FLOW,
  REQUIRED_DOCUMENTS,
  TAX_CLASSIFICATIONS,
  WORK_ELIGIBILITY_CATEGORIES,
  agreementPlainText,
  blockerLabel,
  canOpenStep,
  displayTinLast4,
  loadOnboarding,
  onboardingLabel,
  progressSnapshot,
  saveDriverInfo,
  saveDriverTaxInfo,
  saveEmploymentVerification,
  signDriverAgreement,
  stepIsComplete,
  loadApplicantInbox,
  replyApplicantInbox,
  submitDriverReview,
  uploadDriverDocument,
  type OnboardingBundle,
} from 'rides-native/driverOnboardingClient'
import { loadDriverProfile, loadVehicle } from 'rides-native/driverDesk'
import { TESLA_FLEET_NOTICE } from 'rides-native/tripTags'
import { useTheme } from '@/lib/theme'
import type { Palette } from '@/lib/palette'

const STEP_KINDS = ['account', 'documents', 'employment', 'tax', 'agreement', 'review'] as const
type StepKind = (typeof STEP_KINDS)[number]

type Answers = {
  isStudent: boolean | null
  hasCar: boolean | null
  hasInsurance: boolean | null
  wantsExtraMoney: boolean | null
}

const QUESTIONS: { key: keyof Answers; label: string }[] = [
  { key: 'isStudent', label: 'Are you a student?' },
  { key: 'hasCar', label: 'Do you have a car?' },
  { key: 'hasInsurance', label: 'Do you have insurance?' },
  { key: 'wantsExtraMoney', label: 'Do you want to make extra money driving fellow students?' },
]

function isStepKind(value: string): value is StepKind {
  return (STEP_KINDS as readonly string[]).includes(value)
}

type PickedFile = { uri: string; name?: string; mimeType?: string; size?: number }

async function pickDocument(): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['image/*', 'application/pdf'],
    copyToCacheDirectory: true,
    multiple: false,
  })
  if (result.canceled || !result.assets?.[0]) return null
  const asset = result.assets[0]
  return { uri: asset.uri, name: asset.name, mimeType: asset.mimeType || undefined, size: asset.size }
}

async function takePhoto(): Promise<PickedFile | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync()
  if (!perm.granted) throw new Error('Camera permission is required to photograph documents.')
  const shot = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.7,
  })
  if (shot.canceled || !shot.assets?.[0]) return null
  const asset = shot.assets[0]
  return { uri: asset.uri, name: asset.fileName || 'photo.jpg', mimeType: asset.mimeType || 'image/jpeg', size: asset.fileSize }
}

export default function OnboardingScreen() {
  const styles = useOnboardingStyles()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const [bundle, setBundle] = useState<OnboardingBundle | null>(null)
  const [stepId, setStepId] = useState('account')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Answers>({
    isStudent: null,
    hasCar: null,
    hasInsurance: null,
    wantsExtraMoney: null,
  })
  const [attestation, setAttestation] = useState(false)
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [make, setMake] = useState('')
  const [model, setModel] = useState('')
  const [color, setColor] = useState('')
  const [plate, setPlate] = useState('')
  const [seats, setSeats] = useState('4')
  const [isTesla, setIsTesla] = useState(false)
  const [backgroundOk, setBackgroundOk] = useState(false)
  const [eligibility, setEligibility] = useState('')
  const [eligibilityOk, setEligibilityOk] = useState(false)
  const [legalName, setLegalName] = useState('')
  const [taxClass, setTaxClass] = useState(TAX_CLASSIFICATIONS[0]?.id || 'individual')
  const [tin, setTin] = useState('')
  const [signature, setSignature] = useState('')
  const [inboxMessages, setInboxMessages] = useState<{ id: string; author_role: string; kind?: string; body: string }[]>([])
  const [inboxRequests, setInboxRequests] = useState<{ id: string; prompt: string; status: string }[]>([])
  const [inboxDraft, setInboxDraft] = useState('')

  const refresh = useCallback(async () => {
    if (!user || !supabase) return
    const [next, profile, vehicle] = await Promise.all([
      loadOnboarding(supabase, user.id),
      loadDriverProfile(supabase, user.id).catch(() => null),
      loadVehicle(supabase, user.id).catch(() => null),
    ])
    setBundle(next)
    setStepId(next.stepId)
    const tax = next.tax
    const profileName = String(profile?.full_name || user.user_metadata?.full_name || user.email?.split('@')[0] || '')
    if (profileName) {
      setFullName(profileName)
      setLegalName((current) => current || String(tax?.legal_name || profileName))
    }
    if (profile?.phone) setPhone(String(profile.phone))
    if (next.application) {
      setAnswers({ isStudent: true, hasCar: true, hasInsurance: true, wantsExtraMoney: true })
      setAttestation(true)
    }
    if (vehicle) {
      setMake(String(vehicle.make || ''))
      setModel(String(vehicle.model || ''))
      setColor(String(vehicle.color || ''))
      setPlate(String(vehicle.plate || ''))
      setSeats(String(vehicle.seats || 4))
      setIsTesla(Boolean(vehicle.is_tesla))
    }
    if (tax?.legal_name) setLegalName(String(tax.legal_name))
    if (tax?.tax_classification) setTaxClass(String(tax.tax_classification))
    const app = next.application
    setBackgroundOk(Boolean(app?.background_authorized_at))
    setEligibilityOk(Boolean(app?.work_eligibility_attested_at))
    if (app?.work_eligibility_category) setEligibility(String(app.work_eligibility_category))
    if (next.agreement?.signature_name) setSignature(String(next.agreement.signature_name))
  }, [user])

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : 'Could not load your application'))
  }, [refresh])

  useEffect(() => {
    if (stepId !== 'review' || !supabase) return undefined
    let alive = true
    loadApplicantInbox(supabase)
      .then((data) => {
        if (!alive) return
        setInboxMessages(data.messages || [])
        setInboxRequests(data.requests || [])
      })
      .catch(() => {})
    return () => { alive = false }
  }, [stepId])

  async function sendInbox() {
    if (!supabase || !inboxDraft.trim()) return
    setBusy(true)
    setError(null)
    try {
      const data = await replyApplicantInbox(supabase, inboxDraft.trim())
      setInboxMessages(data.messages || [])
      setInboxRequests(data.requests || [])
      setInboxDraft('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the reply')
    } finally {
      setBusy(false)
    }
  }

  const step = ONBOARDING_FLOW.find((item) => item.id === stepId) || ONBOARDING_FLOW[0]
  const kind = step && isStepKind(step.kind) ? step.kind : 'account'
  const ctx = bundle?.ctx || {}
  const progress = progressSnapshot({ ...ctx, viewing: stepId })
  const docs = bundle?.documents || []
  const uploaded = new Set(docs.map((doc) => doc.doc_type))
  const stepDocs = REQUIRED_DOCUMENTS.filter((doc) => doc.stepId === step?.id)
  const allYes = QUESTIONS.every((question) => answers[question.key] === true)
  const status = String(bundle?.application?.onboarding_status || '')

  function go(nextId: string) {
    if (bundle && !canOpenStep(nextId, bundle.ctx)) {
      setError('Finish the current step before skipping ahead.')
      return
    }
    setError(null)
    setStepId(nextId)
  }

  async function onUpload(docType: string, file: PickedFile | null) {
    if (!file || !user || !supabase) return
    setUploading(docType)
    setError(null)
    try {
      await uploadDriverDocument(supabase, user.id, docType, file)
      const next = await loadOnboarding(supabase, user.id)
      setBundle(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(null)
    }
  }

  async function onSaveAccount() {
    if (!user || !supabase) return
    if (!allYes || !attestation) {
      setError('Every answer has to be Yes, and you need to accept the attestation. The web signup uses the same rule.')
      return
    }
    if (!fullName.trim() || phone.replace(/\D/g, '').length < 7 || !make.trim() || !model.trim() || !plate.trim()) {
      setError('Name, phone, make, model, and plate are required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await saveDriverInfo(supabase, user, {
        isStudent: true,
        hasCar: true,
        hasInsurance: true,
        wantsExtraMoney: true,
        attestationAccepted: true,
        fullName: fullName.trim(),
        phone: phone.trim(),
        make: make.trim(),
        model: model.trim(),
        color: color.trim(),
        plate: plate.trim(),
        seats: Number(seats) || 4,
        isTesla,
      })
      const next = await loadOnboarding(supabase, user.id)
      setBundle(next)
      setStepId('license')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your info')
    } finally {
      setBusy(false)
    }
  }

  async function onSaveEmployment() {
    if (!user || !supabase || !step) return
    const docsReady = (step.docIds || []).every((id) => uploaded.has(id))
    if (!backgroundOk || !eligibilityOk || !eligibility || !docsReady) {
      setError('Authorize the background check, pick eligibility, and upload both documents.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await saveEmploymentVerification(supabase, user.id, { backgroundAuthorized: true, category: eligibility })
      const next = await loadOnboarding(supabase, user.id)
      setBundle(next)
      setStepId('w9')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save employment')
    } finally {
      setBusy(false)
    }
  }

  async function onSaveTax() {
    if (!user || !supabase) return
    if (!uploaded.has('w9')) {
      setError('Upload the W-9 photo or PDF.')
      return
    }
    if (legalName.trim().length < 2) {
      setError('Enter the legal name on the W-9.')
      return
    }
    const digits = tin.replace(/\D/g, '')
    if (!bundle?.tax && digits.length !== 9) {
      setError('Enter a 9-digit TIN. Only the last four are shown after it is saved.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (digits.length === 9) {
        await saveDriverTaxInfo(supabase, { legalName: legalName.trim(), tin: digits, taxClassification: taxClass })
        setTin('')
      }
      const next = await loadOnboarding(supabase, user.id)
      setBundle(next)
      setStepId('agreement')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save W-9')
    } finally {
      setBusy(false)
    }
  }

  async function onSign() {
    if (!user || !supabase) return
    if (signature.trim().length < 2) {
      setError('Type your legal name to sign.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await signDriverAgreement(supabase, signature.trim())
      const next = await loadOnboarding(supabase, user.id)
      setBundle(next)
      setStepId('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign the agreement')
    } finally {
      setBusy(false)
    }
  }

  async function onSubmit() {
    if (!user || !supabase) return
    setBusy(true)
    setError(null)
    try {
      await submitDriverReview(supabase, user.id)
      await refresh()
      setStepId('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit')
    } finally {
      setBusy(false)
    }
  }

  if (!user) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 12 }]}>
        <BackButton onPress={() => router.back()} />
        <Text style={styles.title}>Sign in to apply</Text>
        <Primary label="Sign in" onPress={() => router.push('/sign-in')} />
      </View>
    )
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <BackButton onPress={() => router.back()} />
        <Text style={styles.kicker}>DRIVER APPLICATION</Text>
        <Text style={styles.title}>Same steps as the web app</Text>
        <Text style={styles.copy}>New drivers are not approved automatically. Your place is saved on the server.</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress.percent}%` }]} />
        </View>
        <Text style={styles.progressLabel}>
          Step {progress.stepNumber} of {progress.total} · {progress.label} · {progress.percent}%
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.steps}>
          {ONBOARDING_FLOW.map((item) => {
            const done = bundle ? stepIsComplete(item.id, bundle.ctx) : false
            const open = !bundle || canOpenStep(item.id, bundle.ctx)
            return (
              <Pressable key={item.id} disabled={!open} onPress={() => go(item.id)} style={[styles.stepChip, item.id === stepId && styles.stepChipOn]}>
                <Text style={[styles.stepChipText, item.id === stepId && styles.stepChipTextOn]}>
                  {done ? '✓ ' : ''}{item.label}
                </Text>
              </Pressable>
            )
          })}
        </ScrollView>
        {status ? <Tag label={onboardingLabel(status)} tone={status === 'approved' ? 'orange' : 'purple'} /> : null}
        {bundle?.application?.rejection_reason ? <ErrorText>{String(bundle.application.rejection_reason)}</ErrorText> : null}
        {error ? <ErrorText>{error}</ErrorText> : null}

        {kind === 'account' ? (
          <Card>
            <Text style={styles.cardTitle}>Account</Text>
            {QUESTIONS.map((question) => (
              <View key={question.key} style={styles.question}>
                <Text style={styles.questionLabel}>{question.label}</Text>
                <View style={styles.yesNo}>
                  {[true, false].map((value) => {
                    const on = answers[question.key] === value
                    return (
                      <Pressable key={String(value)} onPress={() => setAnswers((prev) => ({ ...prev, [question.key]: value }))} style={[styles.choice, on && styles.choiceOn]}>
                        <Text style={[styles.choiceText, on && styles.choiceTextOn]}>{value ? 'Yes' : 'No'}</Text>
                      </Pressable>
                    )
                  })}
                </View>
              </View>
            ))}
            <Pressable onPress={() => setAttestation((value) => !value)} style={styles.checkRow}>
              <View style={[styles.box, attestation && styles.boxOn]} />
              <Text style={styles.checkCopy}>I attest I carry valid auto insurance and will only offer rides to fellow students.</Text>
            </Pressable>
            <Field label="Full name" value={fullName} onChangeText={setFullName} />
            <Field label="Phone" value={phone} onChangeText={setPhone} keyboard="phone-pad" />
            <Field label="Make" value={make} onChangeText={setMake} />
            <Field label="Model" value={model} onChangeText={setModel} />
            <Field label="Color" value={color} onChangeText={setColor} />
            <Field label="Plate" value={plate} onChangeText={setPlate} />
            <Field label="Seats" value={seats} onChangeText={setSeats} keyboard="number-pad" />
            <Pressable onPress={() => setIsTesla((value) => !value)} style={styles.checkRow}>
              <View style={[styles.box, isTesla && styles.boxOn]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.checkCopy}>List a Tesla Model 3 on my profile</Text>
                <Text style={styles.hint}>{TESLA_FLEET_NOTICE}</Text>
              </View>
            </Pressable>
            <Primary label={busy ? 'Saving…' : 'Continue to license'} onPress={onSaveAccount} disabled={busy} />
          </Card>
        ) : null}

        {kind === 'documents' ? (
          <Card>
            <Text style={styles.cardTitle}>{step?.label}</Text>
            <Text style={styles.hint}>Photo or PDF, 8MB or smaller. Replacing a file keeps the latest one.</Text>
            {stepDocs.map((doc) => (
              <DocRow
                key={doc.id}
                label={doc.label}
                hint={doc.hint}
                saved={uploaded.has(doc.id)}
                busy={uploading === doc.id}
                onFile={(file) => onUpload(doc.id, file)}
                onError={setError}
              />
            ))}
            <Primary
              label="Continue"
              disabled={stepDocs.some((doc) => !uploaded.has(doc.id))}
              onPress={() => {
                const idx = ONBOARDING_FLOW.findIndex((item) => item.id === stepId)
                const next = ONBOARDING_FLOW[idx + 1]
                if (next) go(next.id)
              }}
            />
          </Card>
        ) : null}

        {kind === 'employment' ? (
          <Card>
            <Text style={styles.cardTitle}>Employment</Text>
            <Pressable onPress={() => setBackgroundOk((value) => !value)} style={styles.checkRow}>
              <View style={[styles.box, backgroundOk && styles.boxOn]} />
              <Text style={styles.checkCopy}>I authorize a background check, including motor-vehicle records, as a condition of driving.</Text>
            </Pressable>
            <Text style={styles.questionLabel}>Eligibility to work</Text>
            <View style={styles.choices}>
              {WORK_ELIGIBILITY_CATEGORIES.map((item) => {
                const on = eligibility === item.id
                return (
                  <Pressable key={item.id} onPress={() => setEligibility(item.id)} style={[styles.choice, on && styles.choiceOn]}>
                    <Text style={[styles.choiceText, on && styles.choiceTextOn]}>{item.label}</Text>
                  </Pressable>
                )
              })}
            </View>
            <Pressable onPress={() => setEligibilityOk((value) => !value)} style={styles.checkRow}>
              <View style={[styles.box, eligibilityOk && styles.boxOn]} />
              <Text style={styles.checkCopy}>I attest I am eligible to work in the United States in the category I selected, and that the document is mine.</Text>
            </Pressable>
            {stepDocs.map((doc) => (
              <DocRow key={doc.id} label={doc.label} hint={doc.hint} saved={uploaded.has(doc.id)} busy={uploading === doc.id} onFile={(file) => onUpload(doc.id, file)} onError={setError} />
            ))}
            <Primary label={busy ? 'Saving…' : 'Continue to W-9'} onPress={onSaveEmployment} disabled={busy} />
          </Card>
        ) : null}

        {kind === 'tax' ? (
          <Card>
            <Text style={styles.cardTitle}>W-9</Text>
            <Text style={styles.hint}>The full TIN goes only to the save_driver_tax_info database function. This screen keeps the last four.</Text>
            <Field label="Legal name" value={legalName} onChangeText={setLegalName} />
            <Text style={styles.questionLabel}>Federal tax classification</Text>
            <View style={styles.choices}>
              {TAX_CLASSIFICATIONS.map((item) => {
                const on = taxClass === item.id
                return (
                  <Pressable key={item.id} onPress={() => setTaxClass(item.id)} style={[styles.choice, on && styles.choiceOn]}>
                    <Text style={[styles.choiceText, on && styles.choiceTextOn]}>{item.label}</Text>
                  </Pressable>
                )
              })}
            </View>
            <Field
              label="TIN (SSN or EIN)"
              value={tin}
              onChangeText={setTin}
              secure
              keyboard="number-pad"
              placeholder={bundle?.tax?.tin_last4 ? `Saved ${displayTinLast4(bundle.tax.tin_last4)}` : '9 digits'}
            />
            {bundle?.tax?.tin_last4 ? <Text style={styles.saved}>On file: {displayTinLast4(bundle.tax.tin_last4)}</Text> : null}
            {stepDocs.map((doc) => (
              <DocRow key={doc.id} label={doc.label} hint={doc.hint} saved={uploaded.has(doc.id)} busy={uploading === doc.id} onFile={(file) => onUpload(doc.id, file)} onError={setError} />
            ))}
            <Primary label={busy ? 'Saving…' : 'Continue to agreement'} onPress={onSaveTax} disabled={busy} />
          </Card>
        ) : null}

        {kind === 'agreement' ? (
          <Card>
            <Text style={styles.cardTitle}>Independent contractor agreement</Text>
            <ScrollView style={styles.agreement} nestedScrollEnabled>
              <Text style={styles.agreementText}>{agreementPlainText()}</Text>
            </ScrollView>
            <Field label="Type your legal name to sign" value={signature} onChangeText={setSignature} />
            {bundle?.agreement?.signed_at ? <Text style={styles.saved}>Signed {new Date(String(bundle.agreement.signed_at)).toLocaleString()}</Text> : null}
            <Primary label={busy ? 'Signing…' : 'Sign and continue'} onPress={onSign} disabled={busy} tone="purple" />
          </Card>
        ) : null}

        {kind === 'review' ? (
          <Card>
            <Text style={styles.cardTitle}>Submit for review</Text>
            {status === 'approved' ? (
              <Text style={styles.copy}>You are approved. Go online from the driver home.</Text>
            ) : (
              <Text style={styles.copy}>An admin reviews every application. You cannot receive rides until the status is approved.</Text>
            )}
            {(bundle?.blockers || []).map((code) => (
              <Text key={code} style={styles.blocker}>Still needed · {blockerLabel(code)}</Text>
            ))}
            {status === 'pending_review' ? <Tag label="Waiting for admin review" /> : null}
            {inboxRequests.filter((row) => row.status === 'open').map((row) => (
              <Text key={row.id} style={styles.copy}>More information needed. {row.prompt}</Text>
            ))}
            {inboxMessages.map((row) => (
              <Text key={row.id} style={styles.copy}>
                {row.author_role === 'admin' ? 'Admin' : 'You'}: {row.body}
              </Text>
            ))}
            {(inboxMessages.length > 0 || inboxRequests.some((row) => row.status === 'open')) ? (
              <>
                <Field label="Reply to admin" value={inboxDraft} onChangeText={setInboxDraft} multiline />
                <Primary label={busy ? 'Sending…' : 'Send reply'} onPress={sendInbox} disabled={busy || !inboxDraft.trim()} />
              </>
            ) : null}
            {status !== 'approved' && status !== 'pending_review' ? (
              <Primary label={busy ? 'Submitting…' : 'Submit application'} onPress={onSubmit} disabled={busy || (bundle?.blockers.length || 0) > 0} />
            ) : (
              <Primary label="Back to driving" onPress={() => router.replace('/')} />
            )}
          </Card>
        ) : null}
      </ScrollView>
    </View>
  )
}

function DocRow({
  label,
  hint,
  saved,
  busy,
  onFile,
  onError,
}: {
  label: string
  hint: string
  saved: boolean
  busy: boolean
  onFile: (file: PickedFile | null) => void
  onError: (message: string) => void
}) {
  const styles = useOnboardingStyles()
  async function camera() {
    try {
      onFile(await takePhoto())
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Camera failed')
    }
  }

  async function file() {
    try {
      onFile(await pickDocument())
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not open files')
    }
  }

  return (
    <View style={styles.doc}>
      <Text style={styles.questionLabel}>{label}</Text>
      <Text style={styles.hint}>{hint}</Text>
      <Text style={styles.saved}>{saved ? 'Uploaded' : 'Not uploaded yet'}</Text>
      <View style={styles.yesNo}>
        <Pressable disabled={busy} onPress={camera} style={styles.choice}>
          <Text style={styles.choiceText}>{busy ? 'Uploading…' : 'Camera'}</Text>
        </Pressable>
        <Pressable disabled={busy} onPress={file} style={styles.choice}>
          <Text style={styles.choiceText}>File</Text>
        </Pressable>
      </View>
    </View>
  )
}

function useOnboardingStyles() {
  const { colors, scheme } = useTheme()
  const mark = scheme === 'dark' ? colors.ink : colors.purple
  return useMemo(() => StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    scroll: { padding: 16, paddingBottom: 48, gap: 12 },
    kicker: { color: colors.orange, fontWeight: '800' as const, letterSpacing: 1.1, fontSize: 12, marginTop: 12 },
    title: { fontSize: 28, fontWeight: '800' as const, color: colors.title, letterSpacing: -0.4 },
    copy: { color: colors.inkSecondary, fontSize: 15, lineHeight: 21 },
    progressTrack: { height: 8, borderRadius: 999, backgroundColor: colors.track, overflow: 'hidden' as const },
    progressFill: { height: '100%' as const, backgroundColor: colors.orange, borderRadius: 999 },
    progressLabel: { color: colors.title, fontWeight: '700' as const, fontSize: 13 },
    steps: { gap: 8 },
    stepChip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.card },
    stepChipOn: { backgroundColor: colors.fill },
    stepChipText: { color: colors.title, fontWeight: '700' as const, fontSize: 12 },
    stepChipTextOn: { color: colors.onAccent },
    cardTitle: { fontSize: 20, fontWeight: '800' as const, color: colors.title },
    question: { gap: 8 },
    questionLabel: { color: colors.ink, fontWeight: '700' as const, fontSize: 14 },
    yesNo: { flexDirection: 'row' as const, gap: 8 },
    choices: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
    choice: { borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.input },
    choiceOn: { borderColor: mark, backgroundColor: colors.track },
    choiceText: { color: colors.ink, fontWeight: '700' as const },
    choiceTextOn: { color: colors.title },
    checkRow: { flexDirection: 'row' as const, gap: 10, alignItems: 'flex-start' as const },
    box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: mark, marginTop: 2 },
    boxOn: { backgroundColor: colors.orange, borderColor: colors.orange },
    checkCopy: { flex: 1, color: colors.ink, fontSize: 14, lineHeight: 20 },
    hint: { color: colors.inkSecondary, fontSize: 13, lineHeight: 18 },
    saved: { color: colors.title, fontWeight: '700' as const, fontSize: 13 },
    agreement: { maxHeight: 220, backgroundColor: colors.input, borderRadius: 14, padding: 12 },
    agreementText: { color: colors.ink, fontSize: 13, lineHeight: 19 },
    blocker: { color: colors.danger, fontSize: 13 },
    doc: { gap: 6, paddingTop: 8 },
  }), [colors, mark])
}
