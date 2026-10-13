/**
 * Vehicle inspection, due 30 days after the four document categories are
 * first approved. This is not part of goOnlineDocumentGate.
 */
import { ATTENTION_COPY } from './documentCategories.js'

const DAY_MS = 24 * 60 * 60 * 1000

export const INSPECTION_TAB_LABEL = 'Inspection'
export const INSPECTION_OVERDUE_COPY = 'Your vehicle inspection is overdue. Upload it to go back online'
export const INSPECTION_FORM_TYPE = 'inspection_form'

export const INSPECTION_SOURCES = [
  { id: 'lyft', label: 'Lyft' },
  { id: 'uber', label: 'Uber' },
  { id: 'other_platform', label: 'Another platform' },
  { id: 'independent', label: 'Independent inspection' },
]

const SOURCE_IDS = new Set(INSPECTION_SOURCES.map((source) => source.id))

export const INSPECTION_SLOTS = [
  { id: 'inspection_front', label: 'Front', hint: 'Straight-on photo of the front', required: true, kind: 'photo' },
  { id: 'inspection_back', label: 'Back', hint: 'Rear photo of the vehicle', required: true, kind: 'photo' },
  { id: 'inspection_left', label: 'Left side', hint: 'Driver side, full side-to-side', required: true, kind: 'photo' },
  { id: 'inspection_right', label: 'Right side', hint: 'Passenger side, full side-to-side', required: true, kind: 'photo' },
  { id: 'inspection_interior', label: 'Interior', hint: 'Optional photo of the cabin', required: false, kind: 'photo' },
  { id: INSPECTION_FORM_TYPE, label: 'Inspection form', hint: 'Lyft, Uber, another platform, or an independent inspection', required: true, kind: 'form' },
]

const SLOT_IDS = new Set(INSPECTION_SLOTS.map((slot) => slot.id))

export function isInspectionDocType(docType) {
  return SLOT_IDS.has(String(docType || ''))
}

export function isInspectionSource(value) {
  return SOURCE_IDS.has(String(value || '').trim())
}

export function inspectionDueCopy(days) {
  return `Vehicle inspection due in ${days} days`
}

function documentType(row) {
  if (!row || typeof row !== 'object') return ''
  return String(row.doc_type ?? row.type ?? '').trim()
}

function indexDocuments(documents) {
  const indexed = new Map()
  for (const row of documents || []) {
    const type = documentType(row)
    if (type) indexed.set(type, row)
  }
  return indexed
}

function uploaded(row) {
  return Boolean(String(row?.storage_path || '').trim())
}

function rejected(row) {
  return String(row?.review_status ?? '').trim() === 'rejected'
}

function approved(row) {
  return String(row?.review_status ?? '').trim() === 'approved'
}

function formReady(row) {
  return uploaded(row) && !rejected(row) && isInspectionSource(row?.inspection_source)
}

/** Required side photos plus a sourced form, and none of those rows rejected. Interior is optional. */
export function inspectionSubmitted(documents) {
  const indexed = indexDocuments(documents)
  const photosReady = INSPECTION_SLOTS
    .filter((slot) => slot.required && slot.kind === 'photo')
    .every((slot) => {
      const row = indexed.get(slot.id)
      return uploaded(row) && !rejected(row)
    })
  return photosReady && formReady(indexed.get(INSPECTION_FORM_TYPE))
}

function attention(ok) {
  if (ok) return { approved: true, mark: 'check', label: 'Approved' }
  return { approved: false, mark: 'x', label: ATTENTION_COPY }
}

/** Check only when an admin has approved every required inspection upload. */
export function inspectionAttention(documents) {
  const indexed = indexDocuments(documents)
  const ready = INSPECTION_SLOTS.filter((slot) => slot.required).every((slot) => {
    const row = indexed.get(slot.id)
    if (!approved(row)) return false
    if (slot.kind === 'form') return isInspectionSource(row?.inspection_source)
    return true
  })
  return attention(ready)
}

export function inspectionSlots(documents) {
  const indexed = indexDocuments(documents)
  return INSPECTION_SLOTS.map((slot) => {
    const row = indexed.get(slot.id) || null
    const onFile = uploaded(row)
    return {
      id: slot.id,
      label: slot.required ? slot.label : `${slot.label} (optional)`,
      hint: slot.hint,
      row,
      uploaded: onFile,
      action: onFile ? 'replace' : 'upload',
    }
  })
}

function dueInstant(dueAt) {
  if (dueAt == null || dueAt === '') return null
  const time = dueAt instanceof Date ? dueAt.getTime() : new Date(dueAt).getTime()
  return Number.isFinite(time) ? time : null
}

function nowInstant(now) {
  const time = now instanceof Date ? now.getTime() : new Date(now).getTime()
  return Number.isFinite(time) ? time : Date.now()
}

/** Reminder while the deadline is still ahead and a complete submission is not on file. */
export function inspectionCountdown({ documents, dueAt, now = new Date() }) {
  const due = dueInstant(dueAt)
  const at = nowInstant(now)
  if (due == null || at >= due) return null
  if (inspectionSubmitted(documents)) return null
  const days = Math.max(1, Math.ceil((due - at) / DAY_MS))
  return { days, message: inspectionDueCopy(days) }
}

/**
 * Blocks go-online only after inspection_due_at, and only when nothing
 * acceptable is on file. A pending review unblocks. A rejection does not.
 * No deadline means the four-category gate has not been passed yet.
 */
export function inspectionGoOnlineGate({ documents, dueAt, now = new Date() }) {
  const due = dueInstant(dueAt)
  const at = nowInstant(now)
  if (due == null || at < due) return { allowed: true, message: '' }
  if (inspectionSubmitted(documents)) return { allowed: true, message: '' }
  return { allowed: false, message: INSPECTION_OVERDUE_COPY }
}
