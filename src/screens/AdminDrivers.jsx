import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { PrimaryButton } from '../components/PrimaryButton'
import { navigate } from '../lib/navigation'
import { supabase } from '../lib/supabase'
import {
  ADMIN_EMAIL,
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
} from '../lib/driverOnboarding'

const FILTERS = [
  ['pending_review', 'Needs review'],
  ['approved', 'Approved'],
  ['rejected', 'Rejected'],
  ['', 'All'],
]

export function AdminDrivers() {
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
    try {
      const payload = await fetchDriverReviewDetail(profileId)
      setDocs(payload.documents || [])
      setDetail(payload)
    } catch (err) {
      setDocsError(err.message || String(err))
    }
  }

  async function decide(profileId, decision) {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const data = await reviewDriverApplication({ profileId, decision, reason })
      setNote(data.message || (decision === 'approve' ? 'Approved' : 'Rejected'))
      setOpenId(null)
      await load()
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  if (loading || allowed == null) {
    return <div style={{ padding: 40, color: 'var(--ink-secondary)' }}>Loading admin queue…</div>
  }

  if (!allowed) {
    return (
      <div className="fade-in" style={{ minHeight: '100%', background: 'var(--surface-muted)', padding: 24 }}>
        <button type="button" className="pressable" onClick={() => navigate('account')} style={{ fontSize: 20 }}>←</button>
        <h1 style={{ color: 'var(--purple)', marginTop: 12 }}>Admin only</h1>
        <p style={{ color: 'var(--ink-secondary)', lineHeight: 1.45 }}>
          Driver review is limited to {ADMIN_EMAIL} and profiles marked admin. Sign in with that account to approve or reject applications.
        </p>
      </div>
    )
  }

  return (
    <div className="fade-in" style={{ minHeight: '100%', background: 'var(--surface-muted)', padding: '20px 20px 48px' }}>
      <button type="button" className="pressable" onClick={() => navigate('account')} style={{ fontSize: 20 }}>←</button>
      <h1 style={{ fontSize: 26, fontWeight: 800, color: 'var(--purple)', marginTop: 12, letterSpacing: -0.4 }}>
        Driver review
      </h1>
      <p style={{ color: 'var(--ink-secondary)', fontSize: 14, lineHeight: 1.45 }}>
        Approve a driver only after license, insurance, registration, car photos, employment documents, W-9, and the signed contractor agreement are on file. Unapproved drivers cannot receive rides.
      </p>

      {(emailTodo || rows.some((row) => row.notify_error)) && (
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
          const vehicle = row.vehicle
          const vehicleLabel = vehicle
            ? [vehicle.color, vehicle.make, vehicle.model, vehicle.plate].filter(Boolean).join(' ')
            : 'No vehicle on file'
          const active = openId === row.profile_id
          return (
            <div key={row.id} className="sheet" style={{ padding: 16, borderRadius: 18, boxShadow: 'var(--shadow-pill)' }}>
              <button type="button" className="pressable" onClick={() => openRow(row.profile_id)} style={{ width: '100%', textAlign: 'left' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontWeight: 800, color: 'var(--purple)' }}>{name}</div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--orange)' }}>{onboardingLabel(row.onboarding_status)}</div>
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink-secondary)', marginTop: 4 }}>{row.profile?.email}</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>{vehicleLabel}</div>
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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                    <PrimaryButton
                      variant="purple"
                      disabled={busy || (row.onboarding_status !== 'approved' && (row.blockers || detail?.blockers || []).length > 0)}
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

function ComplianceSummary({ row, detail }) {
  const employment = detail?.employment || {
    background_authorized_at: row.background_authorized_at,
    work_eligibility_attested_at: row.work_eligibility_attested_at,
    work_eligibility_category: row.work_eligibility_category,
  }
  const tax = detail?.tax || row.tax || null
  const agreement = detail?.agreement || row.agreement || null
  const blockers = detail?.blocker_labels || row.blocker_labels || []
  const category = WORK_ELIGIBILITY_CATEGORIES.find((item) => item.id === employment.work_eligibility_category)
  const taxClass = TAX_CLASSIFICATIONS.find((item) => item.id === tax?.tax_classification)
  return (
    <div style={{ fontSize: 13, lineHeight: 1.45, marginBottom: 12, color: 'var(--ink-secondary)' }}>
      <div>Background check: {employment.background_authorized_at ? 'Authorized' : 'Missing'}</div>
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
      {blockers.length > 0 && row.onboarding_status !== 'approved' && (
        <div style={{ color: 'var(--danger)', marginTop: 6 }}>
          Approve stays off until: {blockers.join(', ')}
        </div>
      )}
    </div>
  )
}
