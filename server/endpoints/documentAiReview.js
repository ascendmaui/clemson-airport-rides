/**
 * POST /api/driver?action=review-document  { docType, storagePath, width, height }
 * GET  /api/admin-drivers?queue=documents
 * POST /api/admin-drivers  { action: 'review-document', documentId, decision, reason }
 *
 * Admins approve or reject on #/admin?tab=applications.
 * The model never rejects.
 */
import { cors, json, parseBody, userFromAuth, admin } from '../friendRideLib.js'
import { clientErrorMessage } from '../clientError.js'
import { reviewUploadedDriverDocument } from '../documentAiReview.js'
import { AI_DOCUMENT_TYPES } from '../../shared/documentAiReview.js'

const PENDING = ['pending_admin_review', 'pending_manual_review']

export default async function handleDocumentReview(req, res, deps = {}) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  const sb = deps.sb || admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = deps.user !== undefined ? deps.user : await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })
  const { body, error } = parseBody(req)
  if (error) return json(res, 400, { error })
  const result = await reviewUploadedDriverDocument({
    sb,
    userId: user.id,
    docType: body.docType || body.doc_type,
    storagePath: body.storagePath || body.storage_path,
    width: body.width,
    height: body.height,
    vision: deps.vision,
    env: deps.env || process.env,
    deps,
  })
  if (result.error) return json(res, result.status, { error: result.error })
  return json(res, result.status || 200, {
    ok: true,
    documentId: result.documentId,
    reviewStatus: result.reviewStatus,
    aiVerdict: result.aiVerdict,
    aiConfidence: result.aiConfidence,
    aiReason: result.aiReason,
    driverMessage: result.driverMessage,
    notified: result.notified,
  })
}

async function signedUrl(sb, storagePath) {
  try {
    const signed = await sb.storage.from('driver-documents').createSignedUrl(storagePath, 60 * 30)
    return signed?.data?.signedUrl || null
  } catch {
    return null
  }
}

export async function listDocumentReviewQueue(sb) {
  const pending = await sb.from('driver_documents')
    .select('id, profile_id, doc_type, storage_path, review_status, ai_verdict, ai_confidence, ai_reason, ai_reasons, review_note, created_at')
    .in('review_status', PENDING)
    .in('doc_type', [...AI_DOCUMENT_TYPES])
    .order('created_at', { ascending: false })
    .limit(40)
  if (pending?.error) {
    if (/schema cache|does not exist|ai_verdict|ai_reason/i.test(pending.error.message || '')) {
      return { status: 200, documents: [], migrationRequired: true }
    }
    return { status: 500, error: clientErrorMessage(pending.error, 'Could not load documents') }
  }
  const rows = pending.data || []
  const ids = [...new Set(rows.map((row) => row.profile_id).filter(Boolean))]
  let profiles = []
  if (ids.length) {
    const people = await sb.from('profiles').select('id, full_name, email').in('id', ids)
    profiles = people?.data || []
  }
  const profileById = Object.fromEntries(profiles.map((row) => [row.id, row]))
  const documents = []
  for (const row of rows) {
    documents.push({
      id: row.id,
      profileId: row.profile_id,
      docType: row.doc_type,
      name: profileById[row.profile_id]?.full_name || 'Driver',
      email: profileById[row.profile_id]?.email || '',
      reviewStatus: row.review_status,
      aiVerdict: row.ai_verdict,
      aiConfidence: row.ai_confidence,
      aiReason: row.ai_reason,
      aiReasons: row.ai_reasons || [],
      createdAt: row.created_at,
      url: row.storage_path ? await signedUrl(sb, row.storage_path) : null,
    })
  }
  return { status: 200, documents }
}

export async function handleAdminDocumentQueue(sb, res) {
  const queue = await listDocumentReviewQueue(sb)
  if (queue.error) return json(res, queue.status, { error: queue.error })
  return json(res, 200, { documents: queue.documents, migrationRequired: queue.migrationRequired || false })
}

export async function reviewDocumentDecision({ sb, adminUser, documentId, decision, reason }) {
  const id = String(documentId || '').trim()
  const choice = decision === 'approve' ? 'approve' : decision === 'reject' ? 'reject' : ''
  const note = String(reason || '').trim()
  if (!id) return { status: 400, error: 'documentId is required' }
  if (!choice) return { status: 400, error: 'decision must be approve or reject' }
  if (choice === 'reject' && note.length < 3) {
    return { status: 400, error: 'A rejection reason is required' }
  }
  const next = choice === 'approve' ? 'approved' : 'rejected'
  const updated = await sb.from('driver_documents').update({
    review_status: next,
    review_note: choice === 'reject' ? note.slice(0, 500) : null,
    reviewed_at: new Date().toISOString(),
    reviewed_by: adminUser.id,
  }).eq('id', id).select('id, profile_id, doc_type, review_status, ai_verdict, ai_reason, review_note').maybeSingle()
  if (updated?.error) return { status: 500, error: clientErrorMessage(updated.error, 'Could not review the document') }
  if (!updated?.data) return { status: 404, error: 'Document not found' }
  return {
    status: 200,
    ok: true,
    document: updated.data,
    message: next === 'approved'
      ? 'Document approved.'
      : 'Document rejected. The driver needs to upload it again.',
  }
}

export async function handleAdminDocumentDecision(sb, res, adminUser, body) {
  const result = await reviewDocumentDecision({
    sb,
    adminUser,
    documentId: body.documentId || body.document_id,
    decision: body.decision,
    reason: body.reason,
  })
  if (result.error) return json(res, result.status, { error: result.error })
  return json(res, 200, result)
}
