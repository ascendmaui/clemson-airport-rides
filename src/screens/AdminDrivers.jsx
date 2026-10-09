import { VehicleFleetEditor } from '../components/VehicleFleetEditor'
import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { PrimaryButton } from '../components/PrimaryButton'
import { navigate } from '../lib/navigation'
import { supabase } from '../lib/supabase'
import {
  EMAIL_TODO,
  REQUIRED_DOCUMENTS,
  WORK_ELIGIBILITY_CATEGORIES,
  TAX_CLASSIFICATIONS,
  displayTinLast4,
  isAdminIdentity,
  onboardingLabel,
  fetchDriverQueue,
  fetchDriverReviewDetail,
  reviewDriverApplication,
  emailAgreementToDriver,
  correctAgreementParticulars,
  submittedApplicantEmail,
} from '../lib/driverOnboarding'
import { applicantVehicleLabel } from '../../shared/vehicleYear.js'
import { agreementSendOutcome } from '../../shared/agreementSign.js'
import {
  BACKGROUND_DISCLOSURES,
  VENDOR_CHECK_NOT_PERFORMED,
  backgroundStatusLabel,
  storedBackgroundStatus,
} from '../../shared/backgroundCheck.js'
import {
  assessContractIdentity,
  blockersIgnoringContractIdentity,
  contractMismatchCopy,
} from '../../shared/contractIdentity.js'
import { fetchApplicantThread, messageApplicant, requestApplicantInfo } from '../lib/adminDesk'
import { AdminAccessDenied } from '../components/AdminAccessDenied'

const FILTERS = [
  ['pending_review', 'Needs review'],
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
  ['', 'All'],
]

export function AdminDrivers({ embedded = false }) {
  const { user, loading } = useAuth()
  const [allowed, setAllowed] = useState(null)
  const [filter, setFilter] = useState('pending_review')
  const [rows, setRows] = useState([])
  const [emailTodo, setEmailTodo] = useState(false)
  const [openId, setOpenId] = useState(null)
  const [docs, setDocs] = useState([])
  const [detail, setDetail] = useState(null)
  const [docsError, setDocsError] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)
  const [thread, setThread] = useState({ messages: [], requests: [] })
  const [messageBody, setMessageBody] = useState('')
  const [requestPrompt, setRequestPrompt] = useState('')
  const [signingUrl, setSigningUrl] = useState('')
  const [acceptContractMismatch, setAcceptContractMismatch] = useState(false)
  const [ackBackground, setAckBackground] = useState(false)
  const [particulars, setParticulars] = useState({
    legal_name: '',
    address_line: '',
    phone: '',
    business_name: '',
    vehicle_make: '',
    vehicle_model: '',
    vehicle_color: '',
    vehicle_plate: '',
    vehicle_seats: '',
  })

  useEffect(() => {
    if (loading) return
    if (!user?.id || !supabase) {
      setAllowed(false)
      return
    }
    let alive = true
    supabase
      .from('profiles')
      .select('role, is_admin, email')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return
        setAllowed(isAdminIdentity({
          jwtEmail: user.email,
          role: data?.role,
          isAdmin: data?.is_admin,
        }))
      })
    return () => {
      alive = false
    }
  }, [user, loading])

  async function load() {
    setError(null)
    const data = await fetchDriverQueue(filter || undefined)
    setRows(data.applications || [])
    setEmailTodo(Boolean(data.email_todo_present))
  }

  useEffect(() => {
    if (!allowed) return undefined
    load().catch((err) => setError(err.message || String(err)))
    return undefined
  }, [allowed, filter])

  async function openRow(profileId) {
    setOpenId(profileId)
    setDocs([])
    setDetail(null)
    setDocsError(null)
    setReason('')
    setAcceptContractMismatch(false)
    setAckBackground(false)
    try {
      const payload = await fetchDriverReviewDetail(profileId)
      setDocs(payload.documents || [])
      setDetail(payload)
      setSigningUrl('')
      const prefill = payload.packet?.prefill || {}
      const vehicle = rows.find((row) => row.profile_id === profileId)?.vehicle || {}
      setParticulars({
        legal_name: prefill.legal_name && prefill.legal_name !== 'Not provided' ? prefill.legal_name : (payload.tax?.legal_name || ''),
        address_line: prefill.mailing_address && prefill.mailing_address !== 'Not provided' ? prefill.mailing_address : (payload.tax?.address_line || ''),
        phone: prefill.phone && prefill.phone !== 'Not provided' ? prefill.phone : '',
        business_name: prefill.business_name && prefill.business_name !== 'Not provided' ? prefill.business_name : (payload.tax?.business_name || ''),
        vehicle_make: vehicle.make || '',
        vehicle_model: vehicle.model || '',
        vehicle_color: vehicle.color || '',
        vehicle_plate: vehicle.plate || '',
        vehicle_seats: vehicle.seats ? String(vehicle.seats) : '',
      })
      const conversation = await fetchApplicantThread(profileId).catch((err) => ({ messages: [], requests: [], error: err.message }))
      setThread({ messages: conversation.messages || [], requests: conversation.requests || [] })
      if (conversation.error) setNote(conversation.error)
    } catch (err) {
      setDocsError(err.message || String(err))
    }
  }

  async function sendApplicant(profileId, kind) {
    setBusy(true)
    setError(null)
    try {
      if (kind === 'info') {
        const data = await requestApplicantInfo({ profileId, prompt: requestPrompt })
        setNote(data.emailed ? 'Asked for more information and emailed the applicant.' : (data.email_todo || 'Asked for more information in the driver app.'))
        setRequestPrompt('')
      } else {
        const data = await messageApplicant({ profileId, body: messageBody })
        setNote(data.emailed ? 'Message sent.' : (data.email_todo || 'Message is in the driver application.'))
        setMessageBody('')
      }
      const conversation = await fetchApplicantThread(profileId)
      setThread({ messages: conversation.messages || [], requests: conversation.requests || [] })
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  async function decide(profileId, decision) {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const data = await reviewDriverApplication({
        profileId,
        decision,
        reason,
        acknowledgeContractMismatch: decision === 'approve' && acceptContractMismatch,
        acknowledgeBackgroundReview: decision === 'approve' && ackBackground,
      })
      setNote(data.message || (decision === 'approve' ? 'Approved' : 'Rejected'))
      setOpenId(null)
      await load()
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  async function correctParticulars(profileId) {
    setBusy(true)
    setError(null)
    try {
      const data = await correctAgreementParticulars({ profileId, particulars })
      setDetail((prev) => ({
        ...(prev || {}),
        packet: {
          ...(prev?.packet || {}),
          prefill: data.prefill,
          html_snapshot: data.html_snapshot,
          html_sha256: data.html_sha256,
        },
      }))
      setNote('Agreement particulars updated from the application. The legal text was not edited.')
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  async function emailAgreement(profileId) {
    setBusy(true)
    setError(null)
    try {
      const data = await emailAgreementToDriver(profileId)
      const outcome = agreementSendOutcome(data)
      setSigningUrl(outcome.signingUrl)
      if (outcome.ok) setNote(outcome.message)
      else setError(outcome.message)
    } catch (err) {
      const outcome = agreementSendOutcome(err.payload || {})
      setSigningUrl(outcome.signingUrl)
      if (outcome.ok) setNote(outcome.message)
      else setError(err.message || outcome.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  async function copySigningLink() {
    if (!signingUrl) return
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(signingUrl)
        setNote('Signing link copied. Send it to the driver. Approve stays off until they sign.')
        return
      }
    } catch {
      // The readonly field stays selected as the fallback.
    }
    setNote('Select the signing link and copy it. Approve stays off until they sign.')
  }

  if (loading || allowed == null) {
    return <div style={{ padding: 40, color: 'var(--ink-secondary)' }}>Loading admin queue…</div>
  }

  if (!allowed) return <AdminAccessDenied />

  return (
    <div className="fade-in" style={{ minHeight: embedded ? undefined : '100%', background: embedded ? 'transparent' : 'var(--surface-muted)', padding: embedded ? '8px 0 24px' : '20px 20px 48px' }}>
      {!embedded && <button type="button" className="pressable" onClick={() => navigate('account')} style={{ fontSize: 20 }}>←</button>}
      <h1 style={{ fontSize: embedded ? 18 : 26, fontWeight: 800, color: 'var(--purple)', marginTop: embedded ? 16 : 12, letterSpacing: -0.4 }}>
        Driver review
      </h1>
      <p style={{ color: 'var(--ink-secondary)', fontSize: 14, lineHeight: 1.45 }}>
        Approve a driver only after license, insurance, registration, car photos, employment documents, W-9, and the signed contractor agreement are on file. Unapproved drivers cannot receive rides.
      </p>

      {emailTodo && (
        <div style={{
          marginTop: 12,
          padding: 12,
          borderRadius: 14,
          background: 'rgba(245,102,0,0.1)',
          color: 'var(--ink)',
          fontSize: 13,
          lineHeight: 1.4,
        }}>
          {EMAIL_TODO}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 14, overflowX: 'auto' }}>
        {FILTERS.map(([id, label]) => (
          <button
            key={label}
            type="button"
            className="pressable"
            onClick={() => setFilter(id)}
            style={{
              flex: '0 0 auto',
              padding: '8px 12px',
              borderRadius: 999,
              fontWeight: 700,
              fontSize: 12,
              color: filter === id ? '#fff' : 'var(--purple)',
              background: filter === id ? 'var(--orange)' : 'white',
              border: '1px solid rgba(82,45,128,0.15)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p style={{ color: 'var(--danger)', marginTop: 12 }}>{error}</p>}
      {note && <p style={{ color: 'var(--purple)', fontWeight: 700, marginTop: 12 }}>{note}</p>}

      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.length === 0 && (
          <div className="sheet" style={{ padding: 20, borderRadius: 18, color: 'var(--ink-secondary)' }}>
            No applications in this filter.
          </div>
        )}
        {rows.map((row) => {
          const name = row.profile?.full_name || 'Driver'
          const email = submittedApplicantEmail(row, row.profile)
          const vehicle = row.vehicle
          const vehicleLabel = applicantVehicleLabel(vehicle)
          const active = openId === row.profile_id
          const agreementForIdentity = (active && detail?.agreement) || row.agreement || null
          const taxForIdentity = (active && detail?.tax) || row.tax || null
          const contractIdentity = assessContractIdentity({
            signatureName: agreementForIdentity?.signature_name,
            contractLegalName: (active && detail?.packet?.prefill?.legal_name) || taxForIdentity?.legal_name,
            applicantName: row.profile?.full_name,
            applicantLegalName: taxForIdentity?.legal_name,
          })
          const agreementSigned = Boolean(agreementForIdentity?.signed_at && agreementForIdentity?.signature_name)
          const employmentForGate = (active && detail?.employment) || row
          const backgroundStatus = storedBackgroundStatus(employmentForGate)
          const backgroundReviewed = Boolean(employmentForGate.background_admin_reviewed_at)
          const needsBackgroundAck = active && backgroundStatus === 'needs_review' && !backgroundReviewed && row.onboarding_status !== 'approved'
          const backgroundAckReady = !needsBackgroundAck || ackBackground
          const approveBlockers = blockersIgnoringContractIdentity(
            (active && detail?.blockers) || row.blockers || [],
            contractIdentity,
            agreementSigned,
          ).filter((code) => !(code === 'background_needs_review' && backgroundAckReady))
          const needsContractConfirm = active && agreementSigned && contractIdentity.status === 'mismatch' && row.onboarding_status !== 'approved'
          const approveLocked = row.onboarding_status !== 'approved' && (
            approveBlockers.length > 0
            || !agreementSigned
            || !backgroundAckReady
            || (needsContractConfirm && !acceptContractMismatch)
          )
          return (
            <div key={row.id} className="sheet" style={{ padding: 16, borderRadius: 18, boxShadow: 'var(--shadow-pill)' }}>
              <button type="button" className="pressable" onClick={() => openRow(row.profile_id)} style={{ width: '100%', textAlign: 'left' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontWeight: 800, color: 'var(--purple)' }}>{name}</div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--orange)' }}>{row.onboarding_status !== 'approved' && (row.blockers || []).some((code) => code !== 'background_needs_review') ? 'Waiting on applicant' : onboardingLabel(row.onboarding_status)}</div>
                </div>
                <div data-applicant-email={email || ''} style={{ fontSize: 13, marginTop: 4, wordBreak: 'break-all' }}>
                  <span style={{ fontWeight: 700, color: 'var(--purple)' }}>Email</span>
                  {' '}
                  <span style={{ color: 'var(--ink)' }}>{email || 'Not submitted'}</span>
                </div>
                <div data-applicant-vehicle={vehicleLabel} style={{ fontSize: 13, marginTop: 4 }}>{vehicleLabel}</div>
                {vehicle && <VehicleFleetEditor driverId={row.profile_id} vehicle={vehicle} admin />}
                {row.review_note && (
                  <div style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginTop: 6 }}>{row.review_note}</div>
                )}
              </button>

              {active && (
                <div style={{ marginTop: 12 }}>
                  {row.rejection_reason && (
                    <p style={{ color: 'var(--danger)', fontSize: 13 }}>Last reason: {row.rejection_reason}</p>
                  )}
                  {docsError && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{docsError}</p>}
                  <ComplianceSummary row={row} detail={detail} />
                  <AgreementReview
                    detail={detail}
                    particulars={particulars}
                    setParticulars={setParticulars}
                    signingUrl={signingUrl}
                    busy={busy}
                    onCorrect={() => correctParticulars(row.profile_id)}
                    onEmail={() => emailAgreement(row.profile_id)}
                    onCopy={copySigningLink}
                  />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {REQUIRED_DOCUMENTS.map((doc) => {
                      const file = docs.find((d) => d.doc_type === doc.id)
                      const isPdf = /\.pdf($|\?)/i.test(file?.storage_path || '')
                      return (
                        <div key={doc.id} style={{ borderRadius: 12, overflow: 'hidden', background: 'rgba(82,45,128,0.05)', minHeight: 92 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, padding: '6px 8px', color: 'var(--purple)' }}>{doc.label}</div>
                          {file?.review_status || file?.match_status ? (
                            <div style={{ fontSize: 11, padding: '0 8px 6px', color: 'var(--ink-secondary)' }}>
                              {[file.review_status, file.match_status].filter(Boolean).join(' · ')}
                            </div>
                          ) : null}
                          {file?.url && isPdf ? (
                            <a href={file.url} target="_blank" rel="noreferrer" style={{ display: 'block', padding: 8, fontSize: 12 }}>Open PDF</a>
                          ) : file?.url ? (
                            <a href={file.url} target="_blank" rel="noreferrer">
                              <img src={file.url} alt={doc.label} style={{ width: '100%', height: 88, objectFit: 'cover' }} />
                            </a>
                          ) : (
                            <div style={{ fontSize: 12, color: 'var(--ink-tertiary)', padding: 8 }}>Missing</div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  <label style={{ display: 'block', marginTop: 12, fontSize: 13, fontWeight: 650 }}>
                    Rejection reason
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={3}
                      style={{
                        display: 'block',
                        width: '100%',
                        marginTop: 6,
                        borderRadius: 12,
                        border: '1px solid var(--border)',
                        padding: 10,
                      }}
                    />
                  </label>
                  <ThreadList thread={thread} />
                  <label style={{ display: 'block', marginTop: 12, fontSize: 13, fontWeight: 650 }}>
                    Message applicant
                    <textarea value={messageBody} onChange={(e) => setMessageBody(e.target.value)} rows={2} style={fieldStyle} />
                  </label>
                  <button type="button" className="pressable" disabled={busy || !messageBody.trim()} onClick={() => sendApplicant(row.profile_id, 'message')} style={quietButton}>
                    Send message
                  </button>
                  <label style={{ display: 'block', marginTop: 12, fontSize: 13, fontWeight: 650 }}>
                    Request more information
                    <textarea value={requestPrompt} onChange={(e) => setRequestPrompt(e.target.value)} rows={2} placeholder="Which document or answer do you need?" style={fieldStyle} />
                  </label>
                  <button type="button" className="pressable" disabled={busy || requestPrompt.trim().length < 4} onClick={() => sendApplicant(row.profile_id, 'info')} style={quietButton}>
                    Send request
                  </button>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                    {needsContractConfirm && (
                      <div>
                        <p role="alert" style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>
                          {contractMismatchCopy(contractIdentity.contractName, contractIdentity.applicantName)}
                        </p>
                        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, marginTop: 8 }}>
                          <input
                            type="checkbox"
                            checked={acceptContractMismatch}
                            onChange={(e) => setAcceptContractMismatch(e.target.checked)}
                          />
                          <span>I checked the contract. Approve this applicant anyway.</span>
                        </label>
                      </div>
                    )}
                    {needsBackgroundAck && (
                      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 }}>
                        <input
                          type="checkbox"
                          checked={ackBackground}
                          onChange={(e) => setAckBackground(e.target.checked)}
                        />
                        <span>I reviewed the yes disclosure. This is not a completed background check.</span>
                      </label>
                    )}
                    <PrimaryButton
                      variant="purple"
                      disabled={busy || approveLocked}
                      onClick={() => decide(row.profile_id, 'approve')}
                    >
                      {busy ? 'Saving…' : 'Approve driver'}
                    </PrimaryButton>
                    <button
                      type="button"
                      className="pressable"
                      disabled={busy}
                      onClick={() => decide(row.profile_id, 'reject')}
                      style={{
                        padding: 14,
                        borderRadius: 16,
                        fontWeight: 700,
                        color: 'var(--danger)',
                        border: '1.5px solid rgba(217,45,32,0.35)',
                        background: 'white',
                      }}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const fieldStyle = {
  display: 'block',
  width: '100%',
  marginTop: 6,
  borderRadius: 12,
  border: '1px solid var(--border)',
  padding: 10,
}

const quietButton = {
  marginTop: 8,
  padding: 12,
  borderRadius: 16,
  fontWeight: 700,
  color: 'var(--purple)',
  border: '1.5px solid rgba(82,45,128,0.3)',
  background: 'white',
}

function ThreadList({ thread }) {
  const messages = thread?.messages || []
  const requests = thread?.requests || []
  if (!messages.length && !requests.length) return null
  return (
    <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.45 }}>
      {requests.filter((row) => row.status === 'open').map((row) => (
        <div key={row.id} style={{ color: '#F56600' }}>Open request: {row.prompt}</div>
      ))}
      {messages.map((row) => (
        <div key={row.id} style={{ marginTop: 6 }}>
          <strong style={{ color: '#522D80' }}>{row.author_role}{row.kind === 'info_request' ? ' · info request' : ''}</strong>
          {' · '}{row.body}
        </div>
      ))}
    </div>
  )
}

function ComplianceSummary({ row, detail }) {
  const employment = {
    background_authorized_at: row.background_authorized_at,
    background_check_status: row.background_check_status,
    background_disclosures: row.background_disclosures,
    background_admin_reviewed_at: row.background_admin_reviewed_at,
    work_eligibility_attested_at: row.work_eligibility_attested_at,
    work_eligibility_category: row.work_eligibility_category,
    ...(detail?.employment || {}),
  }
  const tax = detail?.tax || row.tax || null
  const agreement = detail?.agreement || row.agreement || null
  const blockers = detail?.blocker_labels || row.blocker_labels || []
  const category = WORK_ELIGIBILITY_CATEGORIES.find((item) => item.id === employment.work_eligibility_category)
  const taxClass = TAX_CLASSIFICATIONS.find((item) => item.id === tax?.tax_classification)
  const backgroundStatus = storedBackgroundStatus(employment)
  const disclosures = employment.background_disclosures && typeof employment.background_disclosures === 'object'
    ? employment.background_disclosures
    : {}
  return (
    <div style={{ fontSize: 13, lineHeight: 1.45, marginBottom: 12, color: 'var(--ink-secondary)' }}>
      <div data-background-status={backgroundStatus}>
        Background attestation: {backgroundStatusLabel(backgroundStatus, employment)}
      </div>
      {BACKGROUND_DISCLOSURES.map((question) => {
        const value = disclosures[question.id]
        const answer = value === true ? 'Yes' : value === false ? 'No' : 'Not answered'
        return (
          <div key={question.id} data-disclosure={question.id}>
            {question.prompt} — {answer}
          </div>
        )
      })}
      <div>{VENDOR_CHECK_NOT_PERFORMED}</div>
      <div>Work eligibility: {category ? category.label : 'Missing'}{employment.work_eligibility_attested_at ? ' · attested' : ''}</div>
      <div>
        W-9: {tax?.legal_name || 'Missing'}
        {tax?.tin_last4 ? ` · TIN ${displayTinLast4(tax.tin_last4)}` : ''}
        {taxClass ? ` · ${taxClass.label}` : ''}
      </div>
      <div>
        Agreement: {agreement?.signature_name
          ? `${agreement.signature_name} · ${agreement.agreement_version} · ${String(agreement.agreement_sha256 || '').slice(0, 12)}`
          : 'Not signed'}
      </div>
      {agreement?.html_snapshot && (
        <AgreementHtml title="Signed copy" html={agreement.html_snapshot} />
      )}
      {blockers.length > 0 && row.onboarding_status !== 'approved' && (
        <div style={{ color: 'var(--danger)', marginTop: 6 }}>
          Approve stays off until: {blockers.join(', ')}
        </div>
      )}
    </div>
  )
}

function AgreementReview({ detail, particulars, setParticulars, signingUrl, busy, onCorrect, onEmail, onCopy }) {
  const packet = detail?.packet
  const fields = [
    ['legal_name', 'Legal name'],
    ['address_line', 'Mailing address'],
    ['phone', 'Phone'],
    ['business_name', 'Business name'],
    ['vehicle_make', 'Vehicle make'],
    ['vehicle_model', 'Vehicle model'],
    ['vehicle_color', 'Vehicle color'],
    ['vehicle_plate', 'Vehicle plate'],
    ['vehicle_seats', 'Seats'],
  ]
  return (
    <div style={{ marginTop: 12 }}>
      <AgreementHtml title="Pre-filled agreement" html={packet?.html_snapshot} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
        {fields.map(([key, label]) => (
          <label key={key} style={{ fontSize: 12, fontWeight: 650 }}>
            {label}
            <input
              value={particulars[key] || ''}
              onChange={(e) => setParticulars((prev) => ({ ...prev, [key]: e.target.value }))}
              style={fieldStyle}
            />
          </label>
        ))}
      </div>
      <button type="button" className="pressable" disabled={busy} onClick={onCorrect} style={quietButton}>
        Save application corrections
      </button>
      <button type="button" className="pressable" disabled={busy} onClick={onEmail} style={quietButton}>
        Email agreement or copy a signing link
      </button>
      {signingUrl && (
        <>
          <label style={{ display: 'block', marginTop: 8, fontSize: 12, fontWeight: 650 }}>
            Signing link
            <input readOnly value={signingUrl} style={fieldStyle} onFocus={(e) => e.target.select()} />
          </label>
          <button type="button" className="pressable" disabled={busy} onClick={onCopy} style={quietButton}>
            Copy signing link
          </button>
        </>
      )}
    </div>
  )
}

function AgreementHtml({ title, html }) {
  if (!html) return null
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--purple)' }}>{title}</div>
      <div
        style={{
          maxHeight: 240,
          overflow: 'auto',
          marginTop: 4,
          padding: 10,
          borderRadius: 12,
          border: '1px solid var(--border)',
          background: 'white',
          fontSize: 12,
          lineHeight: 1.4,
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
