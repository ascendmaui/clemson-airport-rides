import { useFocusEffect, useRouter } from 'expo-router'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BackButton, Card, ErrorText, Field, Primary, Tag } from '@/components/chrome'
import { SignaturePad } from '@/components/SignaturePad'
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
  driverQuizError,
  loadOnboarding,
  onboardingLabel,
  progressSnapshot,
  saveDriverInfo,
  saveDriverW9,
  saveEmploymentVerification,
  signDriverAgreement,
  stepIsComplete,
  loadApplicantInbox,
  replyApplicantInbox,
  submitDriverReview,
  uploadDriverDocument,
  type OnboardingBundle,
} from 'rides-native/driverOnboardingClient'
import { extractReadableText, licensePendingCopy, matchRegistration, reviewLicenseImage } from 'rides-native/documentReview'
import { loadDriverProfile, loadVehicle } from 'rides-native/driverDesk'
import { TESLA_FLEET_NOTICE } from 'rides-native/tripTags'
import { isTeslaMakeModel, modelsForMake, VEHICLE_COLORS, VEHICLE_MAKES } from 'rides-native/vehicleCatalog'
import { useTheme } from '@/lib/theme'
import { knowledgeQuizStatus, knowledgeQuizStatusLabel, loadKnowledgeQuiz } from 'rides-native/driverKnowledgeQuiz'

const HEADLINE = 'Become a driver'
const TAGLINE = 'For Clemson University students — and for drivers already on Uber or Lyft.'

const STEP_KINDS = ['account', 'documents', 'employment', 'tax', 'agreement', 'review'] as const
type StepKind = (typeof STEP_KINDS)[number]

type Answers = {
  isStudent: boolean | null
  hasCar: boolean | null
  hasInsurance: boolean | null
  wantsExtraMoney: boolean | null
}

const QUESTIONS: { key: keyof Answers; label: string; optional?: boolean }[] = [
  { key: 'isStudent', label: 'Are you a Clemson University student?', optional: true },
  { key: 'hasCar', label: 'Do you have a car?' },
  { key: 'hasInsurance', label: 'Do you have auto insurance?' },
  { key: 'wantsExtraMoney', label: 'Do you want extra driving income?', optional: true },
]

const BACKGROUND_TEXT = 'I authorize Clemson RIDES / Operator and its screening vendor to obtain a background check, including criminal history and motor-vehicle records, as a condition of driving. I understand this queues a check as submitted and pending. A vendor connection is not live in this build. My electronic signature and date are my authorization. This is not legal advice.'

const ELIGIBILITY_TEXT = 'I attest that I am eligible to work in the United States in the category I select, that the information is mine, and that I will update it if my status changes. My electronic signature and date are my attestation. This form does not replace legal advice.'

function isStepKind(value: string): value is StepKind {
  return (STEP_KINDS as readonly string[]).includes(value)
}

function todayDate() {
  const date = new Date()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function boolAnswer(value: unknown): boolean | null {
  if (value === true) return true
  if (value === false) return false
  return null
}

type PickedFile = { uri: string; name?: string; mimeType?: string; size?: number; width?: number; height?: number }

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
  return {
    uri: asset.uri,
    name: asset.fileName || 'photo.jpg',
    mimeType: asset.mimeType || 'image/jpeg',
    size: asset.fileSize,
    width: asset.width,
    height: asset.height,
  }
}

async function pickLibrary(): Promise<PickedFile | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
  if (!perm.granted) throw new Error('Photo library permission is required to choose a picture.')
  const shot = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.8,
  })
  if (shot.canceled || !shot.assets?.[0]) return null
  const asset = shot.assets[0]
  return {
    uri: asset.uri,
    name: asset.fileName || 'photo.jpg',
    mimeType: asset.mimeType || 'image/jpeg',
    size: asset.fileSize,
    width: asset.width,
    height: asset.height,
  }
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
  const [notices, setNotices] = useState<Record<string, string>>({})
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
  const [picker, setPicker] = useState<null | 'make' | 'model' | 'color'>(null)
  const [eligibility, setEligibility] = useState('')
  const [legalName, setLegalName] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [address, setAddress] = useState('')
  const [taxClass, setTaxClass] = useState(TAX_CLASSIFICATIONS[0]?.id || 'individual')
  const [tin, setTin] = useState('')
  const [w9Step, setW9Step] = useState(0)
  const [signature, setSignature] = useState('')
  const [inboxMessages, setInboxMessages] = useState<{ id: string; author_role: string; kind?: string; body: string }[]>([])
  const [inboxRequests, setInboxRequests] = useState<{ id: string; prompt: string; status: string }[]>([])
  const [inboxDraft, setInboxDraft] = useState('')
  const [signedOn, setSignedOn] = useState(todayDate())
  const [mark, setMark] = useState<{ x: number; y: number }[]>([])
  const [readAgreement, setReadAgreement] = useState(false)
  const [quizLabel, setQuizLabel] = useState('Not started')

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
      setSignature((current) => current || profileName)
    }
    if (profile?.phone) setPhone(String(profile.phone))
    const app = next.application
    if (app) {
      setAnswers({
        isStudent: boolAnswer(app.is_student),
        hasCar: boolAnswer(app.has_car),
        hasInsurance: boolAnswer(app.has_insurance),
        wantsExtraMoney: boolAnswer(app.wants_extra_money),
      })
      setAttestation(app.has_car === true && app.has_insurance === true && Boolean(app.attestation_accepted_at))
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
    if (app?.work_eligibility_category) setEligibility(String(app.work_eligibility_category))
    if (next.agreement?.signature_name) setSignature(String(next.agreement.signature_name))
  }, [user])

  const loadQuizLabel = useCallback(async () => {
    if (!user || !supabase) return
    const result = await loadKnowledgeQuiz(supabase, user.id)
    setQuizLabel(knowledgeQuizStatusLabel(knowledgeQuizStatus(result.row)))
  }, [user])

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : 'Could not load your application'))
  }, [refresh])

  useFocusEffect(useCallback(() => {
    loadQuizLabel().catch(() => setQuizLabel('Not started'))
  }, [loadQuizLabel]))

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
  const status = String(bundle?.application?.onboarding_status || '')
  const registrationDoc = docs.find((doc) => doc.doc_type === 'registration')
  const registrationMatched = registrationDoc?.match_status === 'matched' || notices.registrationMatched === 'yes'
  const models = modelsForMake(make)

  function go(nextId: string) {
    if (bundle && !canOpenStep(nextId, bundle.ctx)) {
      setError('Finish the current step before skipping ahead.')
      return
    }
    setError(null)
    setStepId(nextId)
  }

  function advance() {
    const idx = ONBOARDING_FLOW.findIndex((item) => item.id === stepId)
    const next = ONBOARDING_FLOW[idx + 1]
    if (next) go(next.id)
  }

  async function onUpload(docType: string, file: PickedFile | null) {
    if (!file || !user || !supabase) return
    setUploading(docType)
    setError(null)
    try {
      const meta: { reviewStatus?: string; reviewNote?: string; matchStatus?: string } = {}
      if (docType === 'license_front' || docType === 'license_back') {
        const review = reviewLicenseImage({
          mimeType: file.mimeType,
          size: file.size,
          width: file.width,
          height: file.height,
        })
        if (!review.ok || !review.reviewStatus) throw new Error(review.message)
        meta.reviewStatus = review.reviewStatus
        meta.reviewNote = review.message
        setNotices((prev) => ({ ...prev, [docType]: licensePendingCopy(docType) }))
      }
      if (docType === 'registration') {
        const response = await fetch(file.uri)
        const text = extractReadableText(new Uint8Array(await response.arrayBuffer()))
        const match = matchRegistration({ text, make, model, color, plate })
        meta.reviewStatus = match.reviewStatus
        meta.matchStatus = match.status
        meta.reviewNote = match.message
        setNotices((prev) => ({
          ...prev,
          registration: match.message,
          registrationMatched: match.matched ? 'yes' : 'no',
        }))
      }
      await uploadDriverDocument(supabase, user.id, docType, file, meta)
      const next = await loadOnboarding(supabase, user.id)
      setBundle(next)
      if (docType === 'registration' && meta.matchStatus !== 'matched') {
        setError(meta.reviewNote || 'Registration needs another look.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(null)
    }
  }

  async function onSaveAccount() {
    if (!user || !supabase) return
    const quizError = driverQuizError({
      hasCar: answers.hasCar,
      hasInsurance: answers.hasInsurance,
      attestation,
    })
    if (quizError) {
      setError(quizError)
      return
    }
    if (!fullName.trim() || phone.replace(/\D/g, '').length < 7 || !make || !model || !color || !plate.trim()) {
      setError('Name, phone, make, model, color, and plate are required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await saveDriverInfo(supabase, user, {
        isStudent: answers.isStudent === true,
        hasCar: true,
        hasInsurance: true,
        wantsExtraMoney: answers.wantsExtraMoney === true,
        attestationAccepted: true,
        fullName: fullName.trim(),
        phone: phone.trim(),
        make,
        model,
        color,
        plate: plate.trim(),
        seats: Number(seats) || 4,
        isTesla: isTesla || isTeslaMakeModel(make, model),
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
    if (!user || !supabase) return
    if (!eligibility) {
      setError('Select your eligibility to work.')
      return
    }
    if (signature.trim().length < 2 || !signedOn) {
      setError('Sign and date the authorization and eligibility forms.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await saveEmploymentVerification(supabase, user.id, {
        backgroundAuthorized: true,
        category: eligibility,
        signatureName: signature.trim(),
        signedOn,
        signatureMark: { points: mark, typedName: signature.trim() },
      })
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
    if (legalName.trim().length < 2 || address.trim().length < 4) {
      setError('Legal name and address are required.')
      return
    }
    const digits = tin.replace(/\D/g, '')
    if (!bundle?.tax && digits.length !== 9) {
      setError('Enter a 9-digit TIN. Only the last four are shown after it is saved.')
      return
    }
    if (signature.trim().length < 2 || !signedOn) {
      setError('Sign and date the W-9.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await saveDriverW9(supabase, user.id, {
        legalName: legalName.trim(),
        tin: digits,
        taxClassification: taxClass,
        businessName: businessName.trim(),
        address: address.trim(),
        signatureName: signature.trim(),
        signedOn,
        signatureMark: { points: mark, typedName: signature.trim() },
      })
      setTin('')
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
    if (!readAgreement) {
      setError('Review the agreement before you sign.')
      return
    }
    if (signature.trim().length < 2 || !signedOn) {
      setError('Type your legal name and the date to sign.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await signDriverAgreement(supabase, signature.trim(), {
        userId: user.id,
        signedOn,
        signatureMark: { points: mark, typedName: signature.trim(), signedOn },
      })
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
      router.replace('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit')
    } finally {
      setBusy(false)
    }
  }

  const pickerOptions = picker === 'make' ? VEHICLE_MAKES : picker === 'color' ? VEHICLE_COLORS : models
  const docsContinueDisabled = step?.id === 'registration'
    ? !registrationMatched
    : stepDocs.some((doc) => !uploaded.has(doc.id))

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
        <Text style={styles.title}>{HEADLINE}</Text>
        <Text style={styles.copy}>{TAGLINE}</Text>
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
              <Pressable
                key={item.id}
                disabled={!open}
                onPress={() => go(item.id)}
                accessibilityRole="button"
                accessibilityLabel={`${item.label}${done ? ', completed' : ''}`}
                accessibilityState={{ selected: item.id === stepId, disabled: !open }}
                accessibilityHint={open ? 'Switches to step' : 'Complete earlier steps first'}
                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                style={[styles.stepChip, item.id === stepId && styles.stepChipOn]}
              >
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

        {kind === 'account' || kind === 'review' ? (
          <KnowledgeQuizHook label={quizLabel} onPress={() => router.push('/learning')} />
        ) : null}

        {kind === 'account' ? (
          <Card>
            <Text style={styles.cardTitle}>Account</Text>
            <Text style={styles.hint}>Student status is optional. A car and current insurance are required.</Text>
            {QUESTIONS.map((question) => (
              <View key={question.key} style={styles.question}>
                <Text style={styles.questionLabel}>
                  {question.label}{question.optional ? ' (optional)' : ''}
                </Text>
                <View style={styles.yesNo}>
                  {[true, false].map((value) => {
                    const on = answers[question.key] === value
                    return (
                      <Pressable
                        key={String(value)}
                        onPress={() => setAnswers((prev) => ({ ...prev, [question.key]: value }))}
                        accessibilityRole="radio"
                        accessibilityLabel={`${question.label}: ${value ? 'Yes' : 'No'}`}
                        accessibilityState={{ selected: on }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        style={[styles.choice, on && styles.choiceOn]}
                      >
                        <Text style={[styles.choiceText, on && styles.choiceTextOn]}>{value ? 'Yes' : 'No'}</Text>
                      </Pressable>
                    )
                  })}
                </View>
              </View>
            ))}
            <Pressable
              onPress={() => setAttestation((value) => !value)}
              accessibilityRole="checkbox"
              accessibilityLabel="I attest I carry valid auto insurance for the vehicle I will drive."
              accessibilityState={{ checked: attestation }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.checkRow}
            >
              <View style={[styles.box, attestation && styles.boxOn]} />
              <Text style={styles.checkCopy}>I attest I carry valid auto insurance for the vehicle I will drive.</Text>
            </Pressable>
            <Field label="Full name" value={fullName} onChangeText={setFullName} />
            <Field label="Phone" value={phone} onChangeText={setPhone} keyboard="phone-pad" />
            <PickerField label="Make" value={make || 'Select make'} onPress={() => setPicker('make')} />
            <PickerField label="Model" value={make ? (model || 'Select model') : 'Select make first'} onPress={() => make && setPicker('model')} />
            <PickerField label="Color" value={color || 'Select color'} onPress={() => setPicker('color')} />
            <Field label="Plate" value={plate} onChangeText={setPlate} />
            <Field label="Seats" value={seats} onChangeText={setSeats} keyboard="number-pad" />
            <Pressable
              onPress={() => setIsTesla((value) => !value)}
              accessibilityRole="checkbox"
              accessibilityLabel="List a Tesla Model 3 on my profile"
              accessibilityState={{ checked: Boolean(isTesla || isTeslaMakeModel(make, model)) }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.checkRow}
            >
              <View style={[styles.box, (isTesla || isTeslaMakeModel(make, model)) && styles.boxOn]} />
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
            {step?.id === 'license' ? (
              <Text style={styles.hint}>Front and back are checked separately. A clear photo is received for manual review. It is not approved.</Text>
            ) : null}
            {step?.id === 'registration' ? (
              <Text style={styles.hint}>The registration is compared with the make, model, color, and plate you entered. A mismatch is flagged.</Text>
            ) : null}
            {step?.id === 'car' ? (
              <Text style={styles.hint}>Use the camera, your photo library, or a file. 8MB or smaller.</Text>
            ) : null}
            {notices.registration ? <Text style={styles.saved}>{notices.registration}</Text> : null}
            {stepDocs.map((doc) => (
              <DocRow
                key={doc.id}
                label={doc.label}
                hint={doc.hint}
                saved={uploaded.has(doc.id)}
                busy={uploading === doc.id}
                allowLibrary
                allowFile={doc.id !== 'license_front' && doc.id !== 'license_back'}
                notice={notices[doc.id] || docs.find((row) => row.doc_type === doc.id)?.review_note || undefined}
                onFile={(file) => onUpload(doc.id, file)}
                onError={setError}
              />
            ))}
            <Primary label="Continue" disabled={docsContinueDisabled} onPress={advance} />
          </Card>
        ) : null}

        {kind === 'employment' ? (
          <Card>
            <Text style={styles.cardTitle}>Background check and eligibility</Text>
            <ScrollView style={styles.agreement} nestedScrollEnabled>
              <Text style={styles.agreementText}>{BACKGROUND_TEXT}</Text>
              <Text style={styles.agreementText}>{ELIGIBILITY_TEXT}</Text>
            </ScrollView>
            <Text style={styles.questionLabel}>Eligibility to work</Text>
            <View style={styles.choices}>
              {WORK_ELIGIBILITY_CATEGORIES.map((item) => {
                const on = eligibility === item.id
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => setEligibility(item.id)}
                    accessibilityRole="radio"
                    accessibilityLabel={item.label}
                    accessibilityState={{ selected: on }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={[styles.choice, on && styles.choiceOn]}
                  >
                    <Text style={[styles.choiceText, on && styles.choiceTextOn]}>{item.label}</Text>
                  </Pressable>
                )
              })}
            </View>
            <Field label="Legal name" value={signature} onChangeText={setSignature} />
            <Field label="Date" value={signedOn} onChangeText={setSignedOn} placeholder="YYYY-MM-DD" />
            <SignaturePad onChange={setMark} />
            <Text style={styles.hint}>Signing queues the background check as pending. You do not upload a file.</Text>
            <Primary label={busy ? 'Saving…' : 'Sign and continue'} onPress={onSaveEmployment} disabled={busy} />
          </Card>
        ) : null}

        {kind === 'tax' ? (
          <Card>
            <Text style={styles.cardTitle}>W-9</Text>
            <Text style={styles.hint}>Clemson RIDES contractor tax info. This is not legal or tax advice. The full TIN is stored by the database function. This screen keeps the last four.</Text>
            {w9Step === 0 ? <Field label="Legal name" value={legalName} onChangeText={setLegalName} /> : null}
            {w9Step === 1 ? <Field label="Business name (if any)" value={businessName} onChangeText={setBusinessName} placeholder="Optional" /> : null}
            {w9Step === 2 ? (
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
                      style={[styles.choice, on && styles.choiceOn]}
                    >
                      <Text style={[styles.choiceText, on && styles.choiceTextOn]}>{item.label}</Text>
                    </Pressable>
                  )
                })}
              </View>
            ) : null}
            {w9Step === 3 ? <Field label="Address" value={address} onChangeText={setAddress} /> : null}
            {w9Step === 4 ? (
              <Field
                label="TIN (SSN or EIN)"
                value={tin}
                onChangeText={setTin}
                secure
                keyboard="number-pad"
                placeholder={bundle?.tax?.tin_last4 ? `Saved ${displayTinLast4(bundle.tax.tin_last4)}` : '9 digits'}
              />
            ) : null}
            {w9Step === 5 ? (
              <>
                <Field label="Sign your legal name" value={signature} onChangeText={setSignature} />
                <Field label="Date" value={signedOn} onChangeText={setSignedOn} />
                <SignaturePad onChange={setMark} />
              </>
            ) : null}
            {bundle?.tax?.tin_last4 ? <Text style={styles.saved}>On file: {displayTinLast4(bundle.tax.tin_last4)}</Text> : null}
            <Text style={styles.hint}>Step {w9Step + 1} of 6</Text>
            {w9Step < 5 ? (
              <Primary label="Next" onPress={() => setW9Step((stepIndex) => stepIndex + 1)} />
            ) : (
              <Primary label={busy ? 'Saving…' : 'Sign W-9 and continue'} onPress={onSaveTax} disabled={busy} />
            )}
          </Card>
        ) : null}

        {kind === 'agreement' ? (
          <Card>
            <Text style={styles.cardTitle}>Independent contractor agreement</Text>
            <Text style={styles.hint}>Read the agreement, then sign and date it. Your electronic signature is the agreement.</Text>
            <ScrollView style={styles.agreementTall} nestedScrollEnabled>
              <Text style={styles.agreementText}>{agreementPlainText()}</Text>
            </ScrollView>
            <Pressable
              onPress={() => setReadAgreement((value) => !value)}
              accessibilityRole="checkbox"
              accessibilityLabel="I have reviewed the independent contractor agreement."
              accessibilityState={{ checked: readAgreement }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.checkRow}
            >
              <View style={[styles.box, readAgreement && styles.boxOn]} />
              <Text style={styles.checkCopy}>I have reviewed the independent contractor agreement.</Text>
            </Pressable>
            <Field label="Type your legal name to sign" value={signature} onChangeText={setSignature} />
            <Field label="Date" value={signedOn} onChangeText={setSignedOn} />
            <SignaturePad onChange={setMark} />
            {bundle?.agreement?.signed_at ? <Text style={styles.saved}>Signed {new Date(String(bundle.agreement.signed_at)).toLocaleString()}</Text> : null}
            <Primary label={busy ? 'Signing…' : 'Sign and continue'} onPress={onSign} disabled={busy || !readAgreement} tone="purple" />
          </Card>
        ) : null}

        {kind === 'review' ? (
          <Card>
            <Text style={styles.cardTitle}>Submit for review</Text>
            {status === 'approved' ? (
              <Text style={styles.copy}>You are approved. You can go online from driver home.</Text>
            ) : (
              <Text style={styles.copy}>After you submit, the app opens. You can set up billing, your profile, and photos. Accepting rides stays locked until an admin approves you.</Text>
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
            {status === 'pending_review' || status === 'approved' ? (
              <Primary label="Enter the app" onPress={() => router.replace('/')} />
            ) : (
              <Primary label={busy ? 'Submitting…' : 'Submit application'} onPress={onSubmit} disabled={busy || (bundle?.blockers.length || 0) > 0} />
            )}
          </Card>
        ) : null}
      </ScrollView>
      <Modal visible={picker != null} transparent animationType="slide" onRequestClose={() => setPicker(null)}>
        <Pressable
          style={styles.scrim}
          onPress={() => setPicker(null)}
          accessibilityRole="button"
          accessibilityLabel="Close picker"
          accessibilityHint="Dismisses the selection dialog"
        >
          <Pressable
            style={styles.sheet}
            onPress={(e) => e.stopPropagation()}
            accessibilityRole="none"
            accessibilityLabel="Selection list"
          >
            <Text style={styles.cardTitle}>{picker === 'make' ? 'Make' : picker === 'model' ? 'Model' : 'Color'}</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {pickerOptions.map((option) => (
                <Pressable
                  key={option}
                  style={styles.sheetRow}
                  accessibilityRole="button"
                  accessibilityLabel={option}
                  hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
                  onPress={() => {
                    if (picker === 'make') {
                      setMake(option)
                      setModel('')
                      setIsTesla(isTeslaMakeModel(option, ''))
                    } else if (picker === 'model') {
                      setModel(option)
                      setIsTesla(isTeslaMakeModel(make, option))
                    } else {
                      setColor(option)
                    }
                    setPicker(null)
                  }}
                >
                  <Text style={styles.questionLabel}>{option}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

function KnowledgeQuizHook({ label, onPress }: { label: string; onPress: () => void }) {
  const styles = useOnboardingStyles()
  return (
    <Card>
      <Text style={styles.cardTitle}>Knowledge quiz</Text>
      <Text style={styles.hint}>
        Required Learning Center step. A pass is saved on your application and does not approve you. Accepting rides stays locked until an admin approves you.
      </Text>
      <Tag label={label} tone={label === 'Passed' ? 'orange' : 'purple'} />
      <Primary label="Open knowledge quiz" onPress={onPress} tone="purple" />
    </Card>
  )
}

function PickerField({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  const styles = useOnboardingStyles()
  return (
    <Pressable
      onPress={onPress}
      style={styles.question}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      accessibilityHint="Opens selection dialog"
    >
      <Text style={styles.questionLabel}>{label}</Text>
      <View style={styles.choice}>
        <Text style={styles.choiceText}>{value}</Text>
      </View>
    </Pressable>
  )
}

function DocRow({
  label,
  hint,
  saved,
  busy,
  allowLibrary,
  allowFile,
  notice,
  onFile,
  onError,
}: {
  label: string
  hint: string
  saved: boolean
  busy: boolean
  allowLibrary: boolean
  allowFile: boolean
  notice?: string
  onFile: (file: PickedFile | null) => void
  onError: (message: string) => void
}) {
  const styles = useOnboardingStyles()
  async function run(action: () => Promise<PickedFile | null>, fallback: string) {
    try {
      onFile(await action())
    } catch (err) {
      onError(err instanceof Error ? err.message : fallback)
    }
  }

  return (
    <View style={styles.doc}>
      <Text style={styles.questionLabel}>{label}</Text>
      <Text style={styles.hint}>{hint}</Text>
      <Text style={styles.saved}>{notice || (saved ? 'Uploaded' : 'Not uploaded yet')}</Text>
      <View style={styles.yesNo}>
        <Pressable
          disabled={busy}
          onPress={() => run(takePhoto, 'Camera failed')}
          accessibilityRole="button"
          accessibilityLabel={`Take photo with camera for ${label}`}
          accessibilityState={{ disabled: busy }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.choice}
        >
          <Text style={styles.choiceText}>{busy ? 'Uploading…' : 'Camera'}</Text>
        </Pressable>
        {allowLibrary ? (
          <Pressable
            disabled={busy}
            onPress={() => run(pickLibrary, 'Could not open the photo library')}
            accessibilityRole="button"
            accessibilityLabel={`Choose photo from library for ${label}`}
            accessibilityState={{ disabled: busy }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.choice}
          >
            <Text style={styles.choiceText}>Photo library</Text>
          </Pressable>
        ) : null}
        {allowFile ? (
          <Pressable
            disabled={busy}
            onPress={() => run(pickDocument, 'Could not open files')}
            accessibilityRole="button"
            accessibilityLabel={`Choose file for ${label}`}
            accessibilityState={{ disabled: busy }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.choice}
          >
            <Text style={styles.choiceText}>Files</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

function useOnboardingStyles() {
  const { colors, scheme } = useTheme()
  const accent = scheme === 'dark' ? colors.ink : colors.purple
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
    yesNo: { flexDirection: 'row' as const, gap: 8, flexWrap: 'wrap' as const },
    choices: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
    choice: { borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.input },
    choiceOn: { borderColor: accent, backgroundColor: colors.track },
    choiceText: { color: colors.ink, fontWeight: '700' as const },
    choiceTextOn: { color: colors.title },
    checkRow: { flexDirection: 'row' as const, gap: 10, alignItems: 'flex-start' as const },
    box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: accent, marginTop: 2 },
    boxOn: { backgroundColor: colors.orange, borderColor: colors.orange },
    checkCopy: { flex: 1, color: colors.ink, fontSize: 14, lineHeight: 20 },
    hint: { color: colors.inkSecondary, fontSize: 13, lineHeight: 18 },
    saved: { color: colors.title, fontWeight: '700' as const, fontSize: 13 },
    agreement: { maxHeight: 180, backgroundColor: colors.input, borderRadius: 14, padding: 12 },
    agreementTall: { maxHeight: 280, backgroundColor: colors.input, borderRadius: 14, padding: 12 },
    agreementText: { color: colors.ink, fontSize: 13, lineHeight: 19 },
    blocker: { color: colors.danger, fontSize: 13 },
    doc: { gap: 6, paddingTop: 8 },
    scrim: { flex: 1, backgroundColor: 'rgba(11,18,32,0.45)', justifyContent: 'flex-end' as const },
    sheet: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, gap: 8 },
    sheetRow: { paddingVertical: 12 },
  }), [colors, accent])
}
