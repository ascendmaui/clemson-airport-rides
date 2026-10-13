/**
 * Server-side review for driver license, insurance, registration, and inspection.
 * NVIDIA is called directly. OpenAI is not a fallback. A missing NVIDIA_API_KEY
 * sends every document to manual review. The model never rejects.
 */
import { generateText } from 'ai'
import {
  nvidiaModelNotServed,
  resolveNvidiaDocumentModel,
} from './llm.js'
import {
  decideDocumentReview,
  documentStoragePath,
  isAiReviewedDocument,
} from '../shared/documentAiReview.js'

const EXTRACT_PROMPT = [
  'You read one rideshare driver document.',
  'Reply with JSON only, no markdown:',
  '{"name":string|null,"expiryDate":string|null,"plate":string|null,"vin":string|null,"state":string|null,"documentType":string|null,"legible":"yes"|"no"}',
  'name is the person named on the document.',
  'expiryDate is the expiration date as printed.',
  'plate is the license plate. vin is the 17-character vehicle identification number.',
  'state is the issuing state.',
  'documentType is license, insurance, registration, or inspection.',
  'legible is yes only when the important text can be read.',
  'Do not approve or reject. Do not include a confidence score.',
].join(' ')

function clip(value, max = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

export function safeReviewError(err) {
  const message = String(err?.message || err || 'AI review failed')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/nvapi-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/NVIDIA_API_KEY[=:]\S+/gi, '[redacted]')
  return clip(`AI review failed. ${message}`)
}

export function parseModelJson(text) {
  const raw = String(text || '').trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Document review did not return JSON')
  const parsed = JSON.parse(body.slice(start, end + 1))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Document review did not return JSON')
  }
  return parsed
}

export function mimeFromPath(storagePath) {
  const ext = String(storagePath || '').split('.').pop()?.toLowerCase() || ''
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'heic' || ext === 'heif') return 'image/heic'
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  return 'application/octet-stream'
}

export function imageSize(bytes) {
  if (!bytes || bytes.length < 24) return null
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: readU32(bytes, 16), height: readU32(bytes, 20) }
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return {
        height: (bytes[offset + 5] << 8) + bytes[offset + 6],
        width: (bytes[offset + 7] << 8) + bytes[offset + 8],
      }
    }
    const size = (bytes[offset + 2] << 8) + bytes[offset + 3]
    if (size < 2) break
    offset += 2 + size
  }
  return null
}

function readU32(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
}

async function bytesFromStorage(sb, storagePath) {
  const file = await sb.storage.from('driver-documents').download(storagePath)
  if (file?.error) throw new Error(file.error.message || 'Could not read the stored document')
  const data = file?.data
  if (!data) throw new Error('Could not read the stored document')
  if (typeof data.arrayBuffer === 'function') return new Uint8Array(await data.arrayBuffer())
  if (data instanceof Uint8Array) return data
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) return new Uint8Array(data)
  throw new Error('Could not read the stored document')
}

function contentPart(bytes, mime) {
  if (mime === 'application/pdf') return { type: 'file', data: bytes, mediaType: mime }
  return { type: 'image', image: bytes, mediaType: mime }
}

async function callModel(gen, model, bytes, mime) {
  const result = await gen({
    model,
    temperature: 0,
    maxOutputTokens: 500,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: EXTRACT_PROMPT },
        contentPart(bytes, mime),
      ],
    }],
  })
  return parseModelJson(result?.text || '')
}

export async function readDocumentOnce(input, deps = {}) {
  const env = deps.env || process.env
  const resolve = deps.resolveNvidiaDocumentModel || resolveNvidiaDocumentModel
  const resolved = resolve(env)
  if (!resolved) return { unavailable: true }
  const gen = deps.generateText || generateText
  let modelId = resolved.modelId
  let model = resolved.client(modelId)
  try {
    const json = await callModel(gen, model, input.bytes, input.mime)
    return { ...json, modelId }
  } catch (err) {
    if (!resolved.fallbackModelId || !nvidiaModelNotServed(err)) throw err
    modelId = resolved.fallbackModelId
    model = resolved.client(modelId)
    const json = await callModel(gen, model, input.bytes, input.mime)
    return { ...json, modelId }
  }
}

function siblingOf(docType, rows) {
  const wanted = docType.startsWith('insurance')
    ? ['registration']
    : docType === 'registration' || docType === 'inspection_form'
      ? ['insurance_front', 'insurance_back']
      : []
  for (const type of wanted) {
    const row = (rows || []).find((item) => item.doc_type === type && item.ai_extraction)
    if (!row) continue
    const extracted = row.ai_extraction || {}
    if (extracted.plate || extracted.vin) return { plate: extracted.plate || '', vin: extracted.vin || '' }
  }
  return {}
}

async function loadContext(sb, userId, docType) {
  const profile = await sb.from('profiles').select('full_name').eq('id', userId).maybeSingle()
  let vehicle = await sb.from('vehicles').select('plate, vin').eq('driver_id', userId).limit(1).maybeSingle()
  if (vehicle?.error && /vin|schema cache|column/i.test(vehicle.error.message || '')) {
    vehicle = await sb.from('vehicles').select('plate').eq('driver_id', userId).limit(1).maybeSingle()
  }
  let docs = await sb.from('driver_documents').select('id, doc_type, ai_extraction').eq('profile_id', userId)
  if (docs?.error && /ai_extraction|schema cache|column/i.test(docs.error.message || '')) {
    docs = { data: [] }
  }
  const rows = Array.isArray(docs?.data) ? docs.data : []
  return {
    profileName: profile?.data?.full_name || '',
    vehicle: vehicle?.data || {},
    sibling: siblingOf(docType, rows),
    existing: rows.find((row) => row.doc_type === docType) || null,
  }
}

function missingColumn(error) {
  return /schema cache|does not exist|ai_verdict|ai_confidence|ai_reason|ai_reasons|ai_extraction/i.test(error?.message || '')
}

async function saveReview(sb, { userId, docType, storagePath, verdict }) {
  const patch = {
    profile_id: userId,
    doc_type: docType,
    storage_path: storagePath,
    review_status: verdict.reviewStatus === 'rejected' ? 'pending_manual_review' : verdict.reviewStatus,
    review_note: verdict.aiReason,
    ai_verdict: verdict.aiVerdict,
    ai_confidence: verdict.aiConfidence,
    ai_reason: verdict.aiReason,
    ai_reasons: verdict.aiReasons,
    ai_extraction: verdict.extraction,
    reviewed_at: verdict.reviewStatus === 'approved' ? new Date().toISOString() : null,
    reviewed_by: null,
  }
  const updated = await sb.from('driver_documents')
    .update(patch)
    .eq('profile_id', userId)
    .eq('doc_type', docType)
    .select('id, review_status, ai_verdict, ai_confidence, ai_reason')
    .maybeSingle()
  if (updated?.error) return { error: updated.error }
  if (updated?.data?.id) return { data: updated.data }
  const inserted = await sb.from('driver_documents')
    .insert({ ...patch, created_at: new Date().toISOString() })
    .select('id, review_status, ai_verdict, ai_confidence, ai_reason')
    .maybeSingle()
  if (inserted?.error) return { error: inserted.error }
  return { data: inserted?.data }
}

async function notifyAdmin(sb, { documentId, userId, docType, reason }) {
  let name = ''
  try {
    const profile = await sb.from('profiles').select('full_name').eq('id', userId).maybeSingle()
    name = clip(profile?.data?.full_name, 80)
  } catch {
    name = ''
  }
  const body = clip(name ? `${name}: ${docType}. ${reason}` : `${docType}. ${reason}`)
  const inserted = await sb.from('admin_notifications').insert({
    kind: 'other',
    title: 'Driver document needs a look',
    body: body || 'A driver document needs a look.',
    entity_type: 'driver_document',
    entity_id: String(documentId),
  }).select('id').maybeSingle()
  return !inserted?.error && Boolean(inserted?.data)
}

export async function reviewUploadedDriverDocument({
  sb,
  userId,
  docType,
  storagePath,
  width,
  height,
  vision,
  env = process.env,
  deps = {},
}) {
  if (!isAiReviewedDocument(docType)) {
    return { status: 400, error: 'This document is not reviewed automatically.' }
  }
  const path = documentStoragePath(userId, docType, storagePath)
  if (!path) return { status: 400, error: 'Upload the document to your folder first.' }

  const inspect = vision || ((input) => readDocumentOnce(input, { ...deps, env }))
  let context = { profileName: '', vehicle: {}, sibling: {}, existing: null }
  let signals = { unavailable: true }
  try {
    context = await loadContext(sb, userId, docType)
    const mime = mimeFromPath(path)
    const bytes = await bytesFromStorage(sb, path)
    const parsed = imageSize(bytes)
    const pixelWidth = parsed?.width || Number(width) || 0
    const pixelHeight = parsed?.height || Number(height) || 0
    if (bytes.length > 8 * 1024 * 1024) {
      signals = { error: true, reason: 'This file is too large to review automatically.' }
    } else {
      const seen = await inspect({ bytes, mime, docType })
      if (seen?.unavailable) {
        signals = { unavailable: true }
      } else {
        const again = await inspect({ bytes, mime, docType })
        signals = {
          docType,
          passA: seen,
          passB: again?.unavailable ? seen : again,
          profileName: context.profileName,
          vehicle: context.vehicle,
          sibling: context.sibling,
          byteLength: bytes.length,
          width: pixelWidth,
          height: pixelHeight,
        }
      }
    }
  } catch (err) {
    signals = { error: true, reason: safeReviewError(err) }
  }

  const verdict = decideDocumentReview(signals)
  if (verdict.reviewStatus === 'rejected') {
    verdict.reviewStatus = 'pending_manual_review'
    verdict.notifyAdmin = true
  }
  const saved = await saveReview(sb, { userId, docType, storagePath: path, verdict })
  if (saved.error) {
    if (missingColumn(saved.error)) {
      return { status: 503, error: 'Apply supabase/migrations/20261013220000_driver_document_ai_review.sql' }
    }
    return { status: 500, error: 'Could not save the document review.' }
  }
  if (!saved.data?.id) return { status: 500, error: 'Could not save the document review.' }
  let notified = false
  if (verdict.notifyAdmin) {
    try {
      notified = await notifyAdmin(sb, {
        documentId: saved.data.id,
        userId,
        docType,
        reason: verdict.aiReason,
      })
    } catch (err) {
      console.error('[document-review] notify', safeReviewError(err))
    }
  }
  return {
    status: 200,
    ok: true,
    documentId: saved.data.id,
    reviewStatus: verdict.reviewStatus,
    aiVerdict: verdict.aiVerdict,
    aiConfidence: verdict.aiConfidence,
    aiReason: verdict.aiReason,
    aiReasons: verdict.aiReasons,
    driverMessage: verdict.driverMessage,
    notified,
  }
}
