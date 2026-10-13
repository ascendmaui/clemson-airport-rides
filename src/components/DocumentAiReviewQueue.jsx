import { useEffect, useState } from 'react'
import { fetchDocumentReviewQueue, reviewDriverDocument } from '../lib/driverOnboarding'

/**
 * Admins approve or reject driver documents here:
 * https://clemsonrides.com/#/admin?tab=applications
 * (Admin → Applicants, the Driver review screen).
 * A confident match is already approved. The model never rejects.
 */
export function DocumentAiReviewQueue() {
  const [documents, setDocuments] = useState([])
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [busyId, setBusyId] = useState('')
  const [reasons, setReasons] = useState({})

  async function load() {
    const data = await fetchDocumentReviewQueue()
    setDocuments(data.documents || [])
    if (data.migrationRequired) {
      setError('Apply supabase/migrations/20261013220000_driver_document_ai_review.sql')
    }
  }

  useEffect(() => {
    load().catch((err) => setError(err.message || 'Could not load documents'))
  }, [])

  async function decide(documentId, decision) {
    setBusyId(documentId)
    setError('')
    setNote('')
    try {
      const result = await reviewDriverDocument({
        documentId,
        decision,
        reason: reasons[documentId] || '',
      })
      setNote(result.message || (decision === 'approve' ? 'Document approved.' : 'Document rejected.'))
      await load()
    } catch (err) {
      setError(err.message || 'Could not save that decision')
    } finally {
      setBusyId('')
    }
  }

  return (
    <section aria-label="Document review" style={{ marginTop: 16 }}>
      <h2 style={{ fontSize: 18, fontWeight: 800, color: 'var(--purple)', margin: '0 0 6px' }}>Driver documents</h2>
      <p style={{ color: 'var(--ink-secondary)', fontSize: 13, lineHeight: 1.45, marginTop: 0 }}>
        License, insurance, registration, and inspection files that still need a person are listed here. A clear match is already approved. Rejection stays with an admin.
      </p>
      {error ? <p role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p> : null}
      {note ? <p style={{ color: 'var(--purple)', fontWeight: 700, fontSize: 13 }}>{note}</p> : null}
      {documents.length === 0 ? (
        <div className="sheet" style={{ padding: 16, borderRadius: 18, color: 'var(--ink-secondary)' }}>
          No documents are waiting for review.
        </div>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {documents.map((doc) => {
          const confidence = doc.aiConfidence == null ? null : `${Math.round(Number(doc.aiConfidence) * 100)}%`
          return (
            <div key={doc.id} className="sheet" style={{ padding: 14, borderRadius: 18 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontWeight: 800, color: 'var(--purple)' }}>{doc.name}</div>
                <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--orange)' }}>{doc.reviewStatus}</div>
              </div>
              <div style={{ fontSize: 13, marginTop: 4, fontWeight: 700 }}>{doc.docType}</div>
              <div style={{ fontSize: 13, marginTop: 6, color: 'var(--ink)' }}>
                <span style={{ fontWeight: 800 }}>Reason: </span>
                {doc.aiReason || 'Waiting for manual review.'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-secondary)', marginTop: 4 }}>
                {[doc.aiVerdict, confidence ? `confidence ${confidence}` : null].filter(Boolean).join(' · ')}
              </div>
              {doc.url ? (
                <div style={{ marginTop: 8 }}>
                  <a href={doc.url} target="_blank" rel="noreferrer">Open file</a>
                </div>
              ) : null}
              <label style={{ display: 'block', marginTop: 10, fontSize: 13, fontWeight: 650 }}>
                Rejection reason
                <textarea
                  value={reasons[doc.id] || ''}
                  onChange={(event) => setReasons((prev) => ({ ...prev, [doc.id]: event.target.value }))}
                  rows={2}
                  style={{ display: 'block', width: '100%', marginTop: 6, borderRadius: 12, border: '1px solid var(--border)', padding: 10 }}
                />
              </label>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  className="pressable"
                  disabled={busyId === doc.id}
                  onClick={() => decide(doc.id, 'approve')}
                  style={{ padding: '10px 14px', borderRadius: 14, fontWeight: 800, color: '#fff', background: '#522D80' }}
                >
                  Approve document
                </button>
                <button
                  type="button"
                  className="pressable"
                  disabled={busyId === doc.id}
                  onClick={() => decide(doc.id, 'reject')}
                  style={{ padding: '10px 14px', borderRadius: 14, fontWeight: 800, color: 'var(--danger)', background: '#fff', border: '1.5px solid rgba(217,45,32,0.35)' }}
                >
                  Reject document
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
