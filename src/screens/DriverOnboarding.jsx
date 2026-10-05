import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/auth'
import { PrimaryButton } from '../components/PrimaryButton'
import { ApplicantThread } from '../components/ApplicantThread'
import { OnboardingProgress } from '../components/OnboardingProgress'
import { navigate } from '../lib/navigation'
import { supabase } from '../lib/supabase'
import {
  REQUIRED_DOCUMENTS,
  flowStep,
  adjacentStep,
  onboardingLabel,
  resolveResumeStep,
  canOpenStep,
  stepIsComplete,
  IC_AGREEMENT_VERSION,
  WORK_ELIGIBILITY_CATEGORIES,
  TAX_CLASSIFICATIONS,
  displayTinLast4,
  submissionBlockers,
  blockerLabel,
  buildAgreementPrefill,
  renderPrefilledAgreement,
  fetchMyDriverApplication,
  fetchMyDriverDocuments,
  uploadDriverDocument,
  saveDriverInfo,
  saveEmploymentVerification,
  saveDriverTaxInfo,
  setDriverMailingAddress,
  fetchMyTaxProfile,
  fetchMyAgreement,
  submitDriverReview,
  readOnboardingStep,
  writeOnboardingStep,
} from '../lib/driverOnboarding'
import { COMFORT_FLEET_NOTICE } from '../../packages/rides-native/tripTags.js'
import { buildFieldA11yProps, formatAccessibleFormErrorSummary, getFieldErrorProps } from '../lib/formA11y'
import { loadLatestVehicle, vehicleAccountErrors } from '../../shared/vehicleYear.js'
import { driverQuizError } from '../../shared/driverQuiz.js'
import { forwardCtaDisabled, nextStepHint, nextStepTargetId, showNextStepHint, w9ContinueIssue } from '../../shared/driverOnboarding.js'

const QUESTIONS = [
  { key: 'isStudent', label: 'Are you a student?', optional: true },
  { key: 'hasCar', label: 'Do you have a car?' },
  { key: 'hasInsurance', label: 'Do you have insurance?' },
  { key: 'wantsExtraMoney', label: 'Do you want to make extra money driving fellow students?', optional: true },
]

const STUDENT_OPTIONAL_NOTE = 'Student status is optional. Answering No does not block this application.'

const inputStyle = {
  display: 'block',
  width: '100%',
  maxWidth: '100%',
  marginTop: 6,
  padding: '12px 14px',
  borderRadius: 12,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  fontSize: 16,
  minHeight: 44,
}

function Field({ id, label, value, onChange, type = 'text', required = true, error, inputMode, autoComplete, maxLength }) {
  const a11y = buildFieldA11yProps({ id, error, required })
  return (
    <label htmlFor={id} style={{ display: 'block', marginBottom: 12, maxWidth: '100%' }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>
        {label}{required ? ' *' : ''}
      </span>
      <input
        {...a11y}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        maxLength={maxLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-driver-field={id}
        style={inputStyle}
      />
      {error ? <span {...getFieldErrorProps(id)}>{error}</span> : null}
    </label>
  )
}

function preferredStepFromUrl() {
  if (typeof window === 'undefined') return null
  const qs = (window.location.hash || '').split('?')[1] || ''
  return new URLSearchParams(qs).get('step')
}

function rememberStep(userId, stepId) {
  writeOnboardingStep(userId, stepId)
  if (typeof window === 'undefined') return
  const next = `#/driver-onboarding?step=${encodeURIComponent(stepId)}`
  if (window.location.hash !== next) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${next}`)
  }
}

function DocCard({ doc, saved, busy, onFile }) {
  return (
    <label style={{
      display: 'block',
      padding: 12,
      borderRadius: 16,
      border: saved ? '1.5px solid rgba(31,138,76,0.45)' : '1px solid var(--border)',
      background: saved ? 'rgba(31,138,76,0.06)' : 'rgba(255,255,255,0.7)',
      cursor: 'pointer',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 700, color: 'var(--purple)', fontSize: 14 }}>{doc.label}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginTop: 2 }}>{doc.hint}</div>
        </div>
        <span style={{ fontSize: 12, fontWeight: 800, color: saved ? 'var(--success)' : 'var(--orange)' }}>
          {busy ? 'Uploading…' : saved ? 'Done' : 'Add'}
        </span>
      </div>
      {saved?.url && !/\.pdf($|\?)/i.test(saved.storage_path || '') && (
        <img src={saved.url} alt="" style={{ marginTop: 10, width: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 12 }} />
      )}
      <input
        type="file"
        accept="image/*,application/pdf"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          onFile(file)
        }}
      />
    </label>
  )
}

export function DriverOnboarding() {
  const { user, loading } = useAuth()
  const [step, setStep] = useState('account')
  const [booting, setBooting] = useState(true)
  const [answers, setAnswers] = useState({
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
  const [year, setYear] = useState('')
  const [plate, setPlate] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [seats, setSeats] = useState('4')
  const [comfortClass, setIsComfort] = useState(false)
  const [application, setApplication] = useState(null)
  const [docs, setDocs] = useState([])
  const [uploading, setUploading] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)
  const [backgroundAuthorized, setBackgroundAuthorized] = useState(false)
  const [eligibilityCategory, setEligibilityCategory] = useState('')
  const [eligibilityAttested, setEligibilityAttested] = useState(false)
  const [legalName, setLegalName] = useState('')
  const [addressLine, setAddressLine] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [tin, setTin] = useState('')
  const [taxClass, setTaxClass] = useState('individual')
  const [taxProfile, setTaxProfile] = useState(null)
  const [agreement, setAgreement] = useState(null)

  const uploaded = useMemo(() => docs.map((d) => d.doc_type), [docs])
  const status = application?.onboarding_status || null
  const gate = {
    status,
    uploaded,
    registrationMatch: docs.find((doc) => doc.doc_type === 'registration')?.match_status || null,
    backgroundAuthorized: Boolean(application?.background_authorized_at),
    workEligibilityAttested: Boolean(application?.work_eligibility_attested_at),
    workEligibilityCategory: application?.work_eligibility_category || null,
    taxSaved: Boolean(taxProfile?.legal_name && /^[0-9]{4}$/.test(String(taxProfile?.tin_last4 || ''))),
    agreementSigned: Boolean(agreement?.signed_at && agreement?.signature_name),
    agreementVersion: agreement?.agreement_version || null,
    vehicleYear: year,
  }
  const agreementPreviewHtml = useMemo(() => renderPrefilledAgreement(buildAgreementPrefill({
    legalName: legalName || taxProfile?.legal_name,
    fullName,
    address: addressLine || taxProfile?.address_line,
    phone,
    email: user?.email,
    vehicle: { make, model, color, plate, seats },
    licenseOnFile: uploaded.includes('license_front') && uploaded.includes('license_back'),
    taxClassification: taxProfile?.tax_classification || taxClass,
    businessName: businessName || taxProfile?.business_name,
    tinLast4: taxProfile?.tin_last4,
    workEligibilityCategory: eligibilityCategory || application?.work_eligibility_category,
  })), [
    legalName, taxProfile, fullName, addressLine, phone, user, make, model, color, plate, seats,
    uploaded, taxClass, businessName, eligibilityCategory, application,
  ])
  const blockers = useMemo(() => submissionBlockers(gate), [
    gate.status,
    gate.uploaded,
    gate.registrationMatch,
    gate.backgroundAuthorized,
    gate.workEligibilityAttested,
    gate.workEligibilityCategory,
    gate.taxSaved,
    gate.agreementSigned,
    gate.agreementVersion,
  ])

  useEffect(() => {
    if (loading) return undefined
    if (!user?.id) {
      setBooting(false)
      return undefined
    }
    let alive = true
    ;(async () => {
      try {
        const app = await fetchMyDriverApplication(user.id)
        if (!alive) return
        setApplication(app)
        if (app?.onboarding_status === 'approved') {
          const signed = await fetchMyAgreement(user.id).catch(() => null)
          if (alive) setAgreement(signed)
          return
        }
        const [documents, profileRes, vehicleRes, tax, signed] = await Promise.all([
          fetchMyDriverDocuments(user.id).catch(() => []),
          supabase
            ? supabase.from('profiles').select('full_name, phone').eq('id', user.id).maybeSingle()
            : Promise.resolve({ data: null }),
          loadLatestVehicle(supabase, user.id),
          fetchMyTaxProfile(user.id).catch(() => null),
          fetchMyAgreement(user.id).catch(() => null),
        ])
        if (!alive) return
        setApplication(app)
        setDocs(documents)
        setTaxProfile(tax)
        setAgreement(signed)
        const profile = profileRes.data
        const vehicle = vehicleRes.data
        const profileName = profile?.full_name || user.user_metadata?.full_name || user.email?.split('@')[0] || ''
        setFullName(profileName)
        setLegalName(tax?.legal_name || profileName)
        setAddressLine(tax?.address_line || '')
        setBusinessName(tax?.business_name || '')
        setTaxClass(tax?.tax_classification || 'individual')
        if (app?.background_authorized_at) setBackgroundAuthorized(true)
        if (app?.work_eligibility_attested_at) setEligibilityAttested(true)
        if (app?.work_eligibility_category) setEligibilityCategory(app.work_eligibility_category)
        setPhone(profile?.phone || '')
        if (app) {
          setAnswers({ isStudent: true, hasCar: true, hasInsurance: true, wantsExtraMoney: true })
          setAttestation(true)
        }
        if (vehicle) {
          setMake(vehicle.make || '')
          setModel(vehicle.model || '')
          setColor(vehicle.color || '')
          setYear(vehicle.year ? String(vehicle.year) : '')
          setPlate(vehicle.plate || '')
          setSeats(String(vehicle.seats || 4))
          setIsComfort(vehicle.service_class === 'comfort' || vehicle.service_class === true || vehicle.tier === 'comfort')
        }
        const resume = resolveResumeStep({
          status: app?.onboarding_status,
          uploaded: documents.map((d) => d.doc_type),
          registrationMatch: documents.find((doc) => doc.doc_type === 'registration')?.match_status || null,
          backgroundAuthorized: Boolean(app?.background_authorized_at),
          workEligibilityAttested: Boolean(app?.work_eligibility_attested_at),
          workEligibilityCategory: app?.work_eligibility_category || null,
          taxSaved: Boolean(tax?.legal_name && /^[0-9]{4}$/.test(String(tax?.tin_last4 || ''))),
          agreementSigned: Boolean(signed?.signed_at && signed?.signature_name),
          agreementVersion: signed?.agreement_version || null,
          preferred: preferredStepFromUrl() || readOnboardingStep(user.id),
        })
        setStep(resume)
        rememberStep(user.id, resume)
      } catch (err) {
        if (alive) setError(err.message || String(err))
      } finally {
        if (alive) setBooting(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [user, loading])

  function go(stepId) {
    const next = canOpenStep(stepId, gate) ? stepId : resolveResumeStep({ ...gate, preferred: stepId })
    setStep(next)
    setError(null)
    if (user?.id) rememberStep(user.id, next)
  }

  async function onSaveInfo(e) {
    e.preventDefault()
    setError(null)
    setNote(null)
    const nextErrors = vehicleAccountErrors({ fullName, phone, make, model, color, plate, year })
    setFieldErrors(nextErrors)
    const quizError = driverQuizError({
      hasCar: answers.hasCar,
      hasInsurance: answers.hasInsurance,
      attestation,
    })
    if (quizError) {
      setError(quizError)
      return
    }
    if (Object.keys(nextErrors).length) {
      setError(formatAccessibleFormErrorSummary(nextErrors))
      return
    }
    setBusy(true)
    try {
      const data = await saveDriverInfo(user, {
        isStudent: answers.isStudent === true,
        hasCar: true,
        hasInsurance: true,
        wantsExtraMoney: answers.wantsExtraMoney === true,
        attestationAccepted: true,
        fullName,
        phone,
        make,
        model,
        color,
        year,
        plate,
        seats: Number(seats) || 4,
        comfortClass,
      })
      const nextStatus = data.onboarding_status
      setApplication((prev) => ({ ...(prev || {}), ...(data.application || {}), onboarding_status: nextStatus }))
      setNote(data.message)
      const nextStep = nextStatus === 'approved' || nextStatus === 'pending_review'
        ? 'review'
        : (adjacentStep('account', 1)?.id || 'license')
      setStep(nextStep)
      if (user?.id) rememberStep(user.id, nextStep)
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  async function onUpload(docType, file) {
    if (!file || !user?.id) return
    setError(null)
    setUploading(docType)
    try {
      const saved = await uploadDriverDocument(user.id, docType, file)
      setDocs((prev) => {
        const rest = prev.filter((d) => d.doc_type !== docType)
        return [...rest, { ...saved, doc_type: docType }]
      })
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setUploading(null)
    }
  }

  function openStep(stepId) {
    setStep(stepId)
    setError(null)
    if (user?.id) rememberStep(user.id, stepId)
  }

  async function onSaveEmployment() {
    if (!user?.id) return
    setError(null)
    setBusy(true)
    try {
      const saved = await saveEmploymentVerification(user.id, {
        backgroundAuthorized: true,
        category: eligibilityCategory,
      })
      setApplication((prev) => ({ ...(prev || {}), ...saved }))
      openStep(adjacentStep('employment', 1)?.id || 'w9')
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  async function onSaveTax() {
    setError(null)
    const digits = tin.replace(/\D/g, '')
    if (!taxProfile && digits.length !== 9) {
      setError('Enter a 9-digit TIN. Only the last four digits are shown after you save.')
      return
    }
    setBusy(true)
    try {
      if (digits.length === 9) {
        const saved = await saveDriverTaxInfo({
          legalName,
          tin: digits,
          taxClassification: taxClass,
        })
        setTaxProfile({
          legal_name: saved.legal_name,
          tin_last4: saved.tin_last4,
          tax_classification: saved.tax_classification,
          address_line: addressLine.trim() || null,
          business_name: businessName.trim() || null,
        })
        setTin('')
      }
      if (addressLine.trim() || businessName.trim()) {
        const mailed = await setDriverMailingAddress({
          addressLine: addressLine.trim(),
          businessName: businessName.trim(),
        })
        setTaxProfile((prev) => ({
          ...(prev || {}),
          address_line: mailed.address_line || addressLine.trim() || null,
          business_name: mailed.business_name || businessName.trim() || prev?.business_name || null,
        }))
      }
      openStep(adjacentStep('w9', 1)?.id || 'agreement')
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  async function onSubmitReview() {
    setError(null)
    setNote(null)
    setBusy(true)
    try {
      const data = await submitDriverReview()
      setApplication((prev) => ({
        ...(prev || {}),
        ...(data.application || {}),
        onboarding_status: data.onboarding_status || 'pending_review',
        notify_error: data.email_todo || null,
      }))
      setNote(data.email_todo ? `${data.message} ${data.email_todo}` : data.message)
      setStep('review')
      if (user?.id) rememberStep(user.id, 'review')
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  if (loading || booting) {
    return <div style={{ padding: 40, color: 'var(--ink-secondary)' }}>Loading application…</div>
  }

  if (status === 'approved') {
    return (
      <div className="driver-application fade-in" style={{ minHeight: '100%', background: 'var(--surface-muted)', padding: '20px 16px 48px' }}>
        <h1 style={{ fontSize: 26, fontWeight: 800, marginTop: 12, color: 'var(--purple)', letterSpacing: -0.4 }}>
          You’re approved
        </h1>
        <p style={{ color: 'var(--ink-secondary)', fontSize: 14, lineHeight: 1.45, marginTop: 8 }}>
          You can go online and accept rides. This application does not block driver mode.
        </p>
        <div style={{ marginTop: 16 }}>
          <PrimaryButton variant="purple" onClick={() => navigate('driver')}>Open driver mode</PrimaryButton>
        </div>
      </div>
    )
  }

  const current = flowStep(step) || flowStep('account')
  const stepDocs = (current.docIds || []).map((id) => REQUIRED_DOCUMENTS.find((doc) => doc.id === id)).filter(Boolean)
  const stepDone = stepIsComplete(current.id, gate)
  const previous = adjacentStep(current.id, -1)
  const next = adjacentStep(current.id, 1)
  const now = new Date()
  const hint = nextStepHint(gate, now)
  const hintVisible = showNextStepHint(current.id, gate, now)
  const stepTarget = nextStepTargetId(gate, now)
  const accountQuizIssue = driverQuizError({
    hasCar: answers.hasCar,
    hasInsurance: answers.hasInsurance,
    attestation,
  })
  const accountIssues = vehicleAccountErrors({ fullName, phone, make, model, color, plate, year }, now)
  const accountReady = !accountQuizIssue && Object.keys(accountIssues).length === 0
  const accountBlockReason = accountQuizIssue
    || (accountIssues.year ? null : Object.values(accountIssues)[0] || null)
  const employmentDocsReady = (flowStep('employment')?.docIds || []).every((id) => uploaded.includes(id))
  const employmentFormOk = backgroundAuthorized && eligibilityAttested && Boolean(eligibilityCategory) && employmentDocsReady
  const w9Issue = w9ContinueIssue({
    legalName,
    taxClass,
    tin,
    taxSaved: Boolean(taxProfile?.legal_name && /^[0-9]{4}$/.test(String(taxProfile?.tin_last4 || ''))),
  })
  const taxFormOk = w9Issue == null

  return (
    <div className="driver-application fade-in" style={{ minHeight: '100%', background: 'var(--surface-muted)', padding: '20px 16px 48px' }}>
      <button
        type="button"
        className="pressable"
        aria-label="Back"
        onClick={() => (previous ? go(previous.id) : navigate('account'))}
        style={{
          fontSize: 20,
          minWidth: 44,
          minHeight: 44,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        ←
      </button>
      <h1 style={{ fontSize: 26, fontWeight: 800, marginTop: 12, color: 'var(--purple)', letterSpacing: -0.4 }}>
        Driver application
      </h1>
      <p style={{ color: 'var(--ink-secondary)', fontSize: 14, lineHeight: 1.45, marginTop: 6 }}>
        New drivers are never auto-approved. Finish each step — your place is saved if you leave.
      </p>

      <OnboardingProgress viewing={current.id} onSelect={go} {...gate} />
      {hintVisible ? (
        <p id="onboarding-next-step" role="status" style={{ marginTop: 12, fontSize: 14, lineHeight: 1.45, color: 'var(--purple)', fontWeight: 650 }}>
          {hint}
        </p>
      ) : null}

      {step === 'account' && (
        <form noValidate onSubmit={onSaveInfo} className="sheet" style={{ marginTop: 16, padding: 20, borderRadius: 22, boxShadow: 'var(--shadow-pill)' }}>
          <h2 style={{ fontSize: 18, color: 'var(--purple)', marginBottom: 12 }}>Account</h2>
          {QUESTIONS.map((q) => (
            <div key={q.key} style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 650, fontSize: 14, marginBottom: 8 }}>
                {q.label}{q.optional ? ' (optional)' : ''}
              </div>
              <div className="choice-pair" style={{ display: 'flex', gap: 8 }}>
                {[true, false].map((val) => (
                  <button
                    key={String(val)}
                    type="button"
                    className="pressable"
                    onClick={() => setAnswers((a) => ({ ...a, [q.key]: val }))}
                    style={{
                      flex: 1,
                      padding: 12,
                      borderRadius: 12,
                      fontWeight: 700,
                      border: answers[q.key] === val ? '2px solid var(--purple)' : '1px solid var(--border)',
                      background: answers[q.key] === val ? 'rgba(82,45,128,0.12)' : 'var(--surface)',
                    }}
                  >
                    {val ? 'Yes' : 'No'}
                  </button>
                ))}
              </div>
              {q.key === 'isStudent' ? (
                <p id="student-status-note" role="status" style={{ marginTop: 8, fontSize: 13, lineHeight: 1.4, color: 'var(--ink-secondary)' }}>
                  {STUDENT_OPTIONAL_NOTE}
                </p>
              ) : null}
              {q.key === 'hasCar' && answers.hasCar === false ? (
                <p className="field-error-text" role="alert">{driverQuizError({ hasCar: false, hasInsurance: true, attestation: true })}</p>
              ) : null}
              {q.key === 'hasInsurance' && answers.hasInsurance === false ? (
                <p className="field-error-text" role="alert">{driverQuizError({ hasCar: true, hasInsurance: false, attestation: true })}</p>
              ) : null}
            </div>
          ))}

          <label className="attest-row" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '8px 0 16px', fontSize: 13, lineHeight: 1.4 }}>
            <input type="checkbox" checked={attestation} onChange={(e) => setAttestation(e.target.checked)} style={{ marginTop: 3 }} />
            <span>I attest I carry valid auto insurance and will only offer rides to fellow students.</span>
          </label>

          {error && step === 'account' ? (
            <p id="driver-account-errors" className="form-summary-alert" role="alert">{error}</p>
          ) : null}
          <Field id="fullName" label="Full name" value={fullName} onChange={setFullName} autoComplete="name" error={fieldErrors.fullName} />
          <Field id="phone" label="Phone" value={phone} onChange={setPhone} type="tel" inputMode="tel" autoComplete="tel" error={fieldErrors.phone} />
          <Field id="make" label="Make" value={make} onChange={setMake} autoComplete="off" error={fieldErrors.make} />
          <Field id="model" label="Model" value={model} onChange={setModel} autoComplete="off" error={fieldErrors.model} />
          <Field id="year" label="Year" value={year} onChange={setYear} inputMode="numeric" autoComplete="off" maxLength={4} error={fieldErrors.year} />
          <Field id="color" label="Color" value={color} onChange={setColor} autoComplete="off" error={fieldErrors.color} />
          <Field id="plate" label="Plate" value={plate} onChange={setPlate} autoComplete="off" error={fieldErrors.plate} />
          <Field id="seats" label="Seats" value={seats} onChange={setSeats} type="number" required={false} />
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 650, marginBottom: comfortClass ? 8 : 16 }}>
            <input type="checkbox" checked={comfortClass} onChange={(e) => setIsComfort(e.target.checked)} />
            Extra Comfort · a driver still drives
          </label>
          {comfortClass ? (
            <p style={{ margin: '0 0 16px', fontSize: 13, lineHeight: 1.4, color: '#522D80', fontWeight: 650 }}>
              {COMFORT_FLEET_NOTICE}
            </p>
          ) : null}
          {accountBlockReason ? (
            <p id="account-continue-reason" role="status" className="field-error-text">{accountBlockReason}</p>
          ) : null}
          <PrimaryButton
            type="submit"
            disabled={busy || !accountReady}
            aria-describedby={accountBlockReason ? 'account-continue-reason' : (hintVisible ? 'onboarding-next-step' : undefined)}
          >
            {busy ? 'Saving…' : `Continue to ${adjacentStep('account', 1)?.label || 'the next step'}`}
          </PrimaryButton>
        </form>
      )}

      {current.kind === 'documents' && (
        <div className="sheet" style={{ marginTop: 16, padding: 20, borderRadius: 22, boxShadow: 'var(--shadow-pill)' }}>
          <h2 style={{ fontSize: 18, color: 'var(--purple)', marginBottom: 6 }}>{current.label}</h2>
          <p style={{ fontSize: 14, color: 'var(--ink-secondary)', lineHeight: 1.45, marginBottom: 14 }}>
            {current.id === 'car'
              ? 'Front, back, left, and right so we can match the vehicle and confirm it is suitable.'
              : 'Clear photos. You can replace a file before you submit.'}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {stepDocs.map((doc) => (
              <DocCard
                key={doc.id}
                doc={doc}
                saved={docs.find((d) => d.doc_type === doc.id)}
                busy={uploading === doc.id}
                onFile={(file) => onUpload(doc.id, file)}
              />
            ))}
          </div>
          <div style={{ marginTop: 16 }}>
            <PrimaryButton
              type="button"
              disabled={!stepDone || Boolean(uploading) || forwardCtaDisabled(current.id, gate, now)}
              aria-describedby={hintVisible ? 'onboarding-next-step' : undefined}
              onClick={() => go(next?.id || 'review')}
            >
              {stepDone ? `Continue to ${next?.label || 'the next step'}` : 'Add the photos on this step'}
            </PrimaryButton>
          </div>
        </div>
      )}

      {current.kind === 'employment' && (
        <div className="sheet" style={{ marginTop: 16, padding: 20, borderRadius: 22, boxShadow: 'var(--shadow-pill)' }}>
          <h2 style={{ fontSize: 18, color: 'var(--purple)', marginBottom: 6 }}>Employment verification</h2>
          <p style={{ fontSize: 14, color: 'var(--ink-secondary)', lineHeight: 1.45, marginBottom: 14 }}>
            Authorize a background check and attest that you are eligible to work. Complete the attestations below. An admin reviews them before you can receive rides.
          </p>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 14, fontSize: 13, lineHeight: 1.45 }}>
            <input type="checkbox" checked={backgroundAuthorized} onChange={(e) => setBackgroundAuthorized(e.target.checked)} style={{ marginTop: 3 }} />
            <span>I authorize Clemson RIDES and its screening provider to obtain a background check, including motor-vehicle records, as a condition of driving on the platform.</span>
          </label>
          <label style={{ display: 'block', marginBottom: 12, fontSize: 13, fontWeight: 650 }}>
            Eligibility to work
            <select
              value={eligibilityCategory}
              onChange={(e) => setEligibilityCategory(e.target.value)}
              style={inputStyle}
            >
              <option value="">Select a category</option>
              {WORK_ELIGIBILITY_CATEGORIES.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 14, fontSize: 13, lineHeight: 1.45 }}>
            <input type="checkbox" checked={eligibilityAttested} onChange={(e) => setEligibilityAttested(e.target.checked)} style={{ marginTop: 3 }} />
            <span>I attest that I am eligible to work in the United States in the category I selected, and that the document I upload is genuine and relates to me.</span>
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {stepDocs.map((doc) => (
              <DocCard
                key={doc.id}
                doc={doc}
                saved={docs.find((d) => d.doc_type === doc.id)}
                busy={uploading === doc.id}
                onFile={(file) => onUpload(doc.id, file)}
              />
            ))}
          </div>
          <div style={{ marginTop: 16 }}>
            <PrimaryButton
              type="button"
              disabled={!employmentFormOk || busy || Boolean(uploading) || forwardCtaDisabled(current.id, gate, now)}
              aria-describedby={hintVisible ? 'onboarding-next-step' : undefined}
              onClick={onSaveEmployment}
            >
              {busy ? 'Saving…' : `Continue to ${next?.label || 'the next step'}`}
            </PrimaryButton>
          </div>
        </div>
      )}

      {current.kind === 'tax' && (
        <div className="sheet" style={{ marginTop: 16, padding: 20, borderRadius: 22, boxShadow: 'var(--shadow-pill)' }}>
          <h2 style={{ fontSize: 18, color: 'var(--purple)', marginBottom: 6 }}>W-9</h2>
          <p style={{ fontSize: 14, color: 'var(--ink-secondary)', lineHeight: 1.45, marginBottom: 14 }}>
            Independent contractors provide a W-9 by entering it here. You do not upload a file. The app stores the full taxpayer identification number in a restricted record and shows only the last four digits.
          </p>
          <Field label="Legal name" value={legalName} onChange={setLegalName} />
          <Field label="Mailing address" value={addressLine} onChange={setAddressLine} />
          <Field label="Business name (optional)" value={businessName} onChange={setBusinessName} />
          <label style={{ display: 'block', marginBottom: 12, fontSize: 13, fontWeight: 650 }}>
            Federal tax classification
            <select value={taxClass} onChange={(e) => setTaxClass(e.target.value)} style={inputStyle}>
              {TAX_CLASSIFICATIONS.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-secondary)' }}>
              TIN (SSN or EIN){taxProfile ? '' : ' *'}
            </span>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              name="driver-tin"
              value={tin}
              onChange={(e) => setTin(e.target.value)}
              placeholder={taxProfile ? `Saved ${displayTinLast4(taxProfile.tin_last4)}` : '9 digits'}
              style={inputStyle}
            />
          </label>
          {taxProfile?.tin_last4 && (
            <p style={{ fontSize: 13, color: 'var(--purple)', fontWeight: 700, marginTop: 0 }}>
              On file: {displayTinLast4(taxProfile.tin_last4)}
            </p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {stepDocs.map((doc) => (
              <DocCard
                key={doc.id}
                doc={doc}
                saved={docs.find((d) => d.doc_type === doc.id)}
                busy={uploading === doc.id}
                onFile={(file) => onUpload(doc.id, file)}
              />
            ))}
          </div>
          {w9Issue ? (
            <p id="w9-continue-reason" role="alert" className="field-error-text">{w9Issue}</p>
          ) : null}
          <div style={{ marginTop: 16 }}>
            <PrimaryButton
              type="button"
              disabled={!taxFormOk || busy || Boolean(uploading) || forwardCtaDisabled('w9', gate, now)}
              aria-describedby={w9Issue ? 'w9-continue-reason' : (hintVisible ? 'onboarding-next-step' : undefined)}
              onClick={onSaveTax}
            >
              {busy ? 'Saving…' : `Continue to ${next?.label || 'the next step'}`}
            </PrimaryButton>
          </div>
        </div>
      )}

      {current.kind === 'agreement' && (
        <div className="sheet" style={{ marginTop: 16, padding: 20, borderRadius: 22, boxShadow: 'var(--shadow-pill)' }}>
          <h2 style={{ fontSize: 18, color: 'var(--purple)', marginBottom: 6 }}>Independent contractor agreement</h2>
          <p style={{ fontSize: 13, color: 'var(--ink-tertiary)', marginTop: 0 }}>
            Version {IC_AGREEMENT_VERSION}. You do not sign during the application. An admin reviews this pre-filled copy and emails you a signing link.
          </p>
          <AgreementHtml html={agreement?.html_snapshot || agreementPreviewHtml} />
          {agreement?.signed_at && (
            <p style={{ fontSize: 13, color: 'var(--purple)' }}>
              Signed by {agreement.signature_name} on {new Date(agreement.signed_at).toLocaleString()}.
            </p>
          )}
          <PrimaryButton
            type="button"
            onClick={() => openStep('review')}
            disabled={forwardCtaDisabled('agreement', gate, now)}
            aria-describedby={hintVisible ? 'onboarding-next-step' : undefined}
          >
            Continue to submit
          </PrimaryButton>
        </div>
      )}

      {step === 'registration' && ['mismatch', 'unreadable'].includes(gate.registrationMatch) && (
        <p role="alert">Replace the registration with a clear copy matching your vehicle before continuing.</p>
      )}

      {step === 'review' && (
        <div className="sheet" style={{ marginTop: 16, padding: 22, borderRadius: 22, boxShadow: 'var(--shadow-pill)' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--orange)' }}>
            {status === 'approved' ? 'Approved' : blockers.length ? 'Waiting on applicant' : status === 'pending_review' ? 'Waiting on admin' : 'Ready to submit'}
          </div>
          {status === 'approved' && (
            <>
              <h2 style={{ fontSize: 22, color: 'var(--purple)', marginTop: 8 }}>You’re approved</h2>
              <p style={{ color: 'var(--ink-secondary)', fontSize: 14, lineHeight: 1.45 }}>
                You can go online and accept rides.
              </p>
              <PrimaryButton variant="purple" onClick={() => navigate('driver')}>Open driver mode</PrimaryButton>
              {agreement?.html_snapshot && <AgreementHtml html={agreement.html_snapshot} />}
            </>
          )}
          {status === 'pending_review' && blockers.length === 0 && (
            <>
              <h2 style={{ fontSize: 22, color: 'var(--purple)', marginTop: 8 }}>Waiting on admin</h2>
              <p style={{ color: 'var(--ink-secondary)', fontSize: 14, lineHeight: 1.45 }}>
                License, insurance, registration, car photos, employment attestations, W-9 information, and your pre-filled contractor agreement are in the queue. You sign after an admin emails you a link. You will not receive rides until an admin approves them.
              </p>
              {application?.notify_error && (
                <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', lineHeight: 1.4 }}>{application.notify_error}</p>
              )}
              {stepTarget === 'account' && (
                <PrimaryButton onClick={() => go('account')}>Continue required steps</PrimaryButton>
              )}
            </>
          )}
          {status === 'rejected' && (
            <>
              <h2 style={{ fontSize: 22, color: 'var(--purple)', marginTop: 8 }}>Changes requested</h2>
              <p style={{ color: 'var(--danger)', fontSize: 14, lineHeight: 1.45 }}>
                {application?.rejection_reason || 'Update the flagged documents and submit again.'}
              </p>
              <PrimaryButton onClick={() => go('license')}>Review documents</PrimaryButton>
            </>
          )}
          {status !== 'approved' && (status !== 'pending_review' || blockers.length > 0) && (
            <>
              {status !== 'rejected' && (
                <h2 style={{ fontSize: 22, color: 'var(--purple)', marginTop: 8 }}>Submit for review</h2>
              )}
              <p style={{ color: 'var(--ink-secondary)', fontSize: 14, lineHeight: 1.45 }}>
                {blockers.length
                  ? `${blockers.length} item${blockers.length === 1 ? '' : 's'} still needed: ${blockers.map(blockerLabel).join(', ')}.`
                  : 'Everything is in. Submitting does not approve you — an admin still has to verify you.'}
              </p>
              {(blockers.length > 0 || stepTarget === 'account') && (
                <PrimaryButton onClick={() => go(stepTarget === 'account' ? 'account' : resolveResumeStep(gate))}>
                  Continue required steps
                </PrimaryButton>
              )}
              <PrimaryButton type="button" onClick={onSubmitReview} disabled={busy || blockers.length > 0 || forwardCtaDisabled('review', gate, now)} aria-describedby={hintVisible ? 'onboarding-next-step' : undefined}>
                {busy ? 'Submitting…' : 'Submit for admin review'}
              </PrimaryButton>
            </>
          )}
          <ApplicantThread />
        </div>
      )}

      {error && step !== 'account' && <p role="alert" style={{ color: 'var(--danger)', fontSize: 13, marginTop: 12 }}>{error}</p>}
      {note && <p style={{ color: 'var(--purple)', fontSize: 13, marginTop: 12, lineHeight: 1.4 }}>{note}</p>}
    </div>
  )
}

function AgreementHtml({ html }) {
  if (!html) return null
  return (
    <div
      style={{
        maxHeight: 280,
        overflow: 'auto',
        marginTop: 12,
        padding: 12,
        borderRadius: 12,
        border: '1px solid var(--border)',
        background: 'white',
        fontSize: 13,
        lineHeight: 1.45,
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
