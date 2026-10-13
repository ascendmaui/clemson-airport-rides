/**
 * What happens when a driver taps GO.
 * Ending a shift is never blocked. Going online turns green only when every
 * required document is approved and the inspection is not overdue. Otherwise
 * the button turns orange and the driver sees the exact files still required.
 */
import {
  ATTENTION_COPY,
  DOCUMENT_CATEGORIES,
  categoryAttention,
  categorySlots,
  goOnlineDocumentGate,
  isDocumentApproved,
} from './documentCategories.js'
import {
  INSPECTION_FORM_TYPE,
  INSPECTION_SLOTS,
  INSPECTION_TAB_LABEL,
  inspectionAttention,
  inspectionGoOnlineGate,
  inspectionSlots,
  isInspectionSource,
} from './vehicleInspection.js'

function slotReason(slot) {
  const status = String(slot.row?.review_status || '').trim()
  if (!slot.uploaded) return 'Missing'
  if (status === 'rejected') return 'Rejected'
  return 'Needs approval'
}

function inspectionBlocking(slot) {
  const status = String(slot.row?.review_status || '').trim()
  if (!slot.uploaded || status === 'rejected') return true
  if (slot.id === INSPECTION_FORM_TYPE && !String(slot.row?.inspection_source || '').trim()) return true
  return false
}

/** Exact files that still block go-online, one row per required upload. */
export function attentionRequiredItems({ documents, dueAt, now = new Date() }) {
  const rows = documents || []
  const items = []
  const docGate = goOnlineDocumentGate(rows)
  if (!docGate.allowed) {
    const blocked = new Set(docGate.sections.map((section) => section.id))
    for (const category of DOCUMENT_CATEGORIES) {
      if (!blocked.has(category.id)) continue
      for (const slot of categorySlots(category.id, rows)) {
        if (isDocumentApproved(slot.row)) continue
        items.push({
          id: slot.id,
          label: slot.label,
          section: category.label,
          reason: slotReason(slot),
        })
      }
    }
  }
  const inspection = inspectionGoOnlineGate({ documents: rows, dueAt, now })
  if (!inspection.allowed) {
    const required = new Set(INSPECTION_SLOTS.filter((slot) => slot.required).map((slot) => slot.id))
    for (const slot of inspectionSlots(rows)) {
      if (!required.has(slot.id) || !inspectionBlocking(slot)) continue
      const status = String(slot.row?.review_status || '').trim()
      items.push({
        id: slot.id,
        label: slot.label,
        section: INSPECTION_TAB_LABEL,
        reason: status === 'rejected' ? 'Rejected' : 'Overdue',
      })
    }
  }
  return {
    items,
    documentsAllowed: docGate.allowed,
    inspectionAllowed: inspection.allowed,
    title: ATTENTION_COPY,
  }
}

function inspectionSlotReason(slot) {
  const spec = INSPECTION_SLOTS.find((row) => row.id === slot.id)
  const status = String(slot.row?.review_status || '').trim()
  if (!slot.uploaded) return 'Missing'
  if (status === 'rejected') return 'Rejected'
  if (spec?.kind === 'form' && !isInspectionSource(slot.row?.inspection_source)) return 'Needs approval'
  return 'Needs approval'
}

/**
 * Rows for the Needs your attention screen. Includes every flagged required
 * file, including an inspection that is not yet overdue. Go-online still uses
 * attentionRequiredItems, which waits out the inspection deadline.
 */
export function attentionScreenItems({ documents, dueAt, now = new Date() }) {
  const base = attentionRequiredItems({ documents, dueAt, now })
  const items = [...base.items]
  const seen = new Set(items.map((item) => item.id))
  function push(item) {
    if (seen.has(item.id)) return
    seen.add(item.id)
    items.push(item)
  }
  for (const category of DOCUMENT_CATEGORIES) {
    if (categoryAttention(category.id, documents).approved) continue
    for (const slot of categorySlots(category.id, documents)) {
      if (isDocumentApproved(slot.row)) continue
      push({
        id: slot.id,
        label: slot.label,
        section: category.label,
        reason: slotReason(slot),
      })
    }
  }
  if (!inspectionAttention(documents).approved) {
    for (const slot of inspectionSlots(documents)) {
      const spec = INSPECTION_SLOTS.find((row) => row.id === slot.id)
      if (!spec?.required) continue
      const status = String(slot.row?.review_status || '').trim()
      const formReady = spec.kind !== 'form' || isInspectionSource(slot.row?.inspection_source)
      if (status === 'approved' && formReady) continue
      push({
        id: slot.id,
        label: spec.label,
        section: INSPECTION_TAB_LABEL,
        reason: inspectionSlotReason(slot),
      })
    }
  }
  return { ...base, items }
}

/**
 * @param {{ goingOnline: boolean, documents?: unknown[] | null, dueAt?: unknown, now?: Date, canGoOnline?: boolean }} input
 */
export function decideGoPress({ goingOnline, documents, dueAt, now = new Date(), canGoOnline = false }) {
  if (!goingOnline) {
    return { outcome: 'offline', tone: 'purple', proceed: true, title: '', items: [] }
  }
  const attention = attentionRequiredItems({ documents, dueAt, now })
  if (!attention.documentsAllowed || !attention.inspectionAllowed) {
    return {
      outcome: 'attention',
      tone: 'orange',
      proceed: false,
      title: attention.title,
      items: attention.items,
    }
  }
  if (!canGoOnline) {
    return { outcome: 'hold', tone: 'orange', proceed: false, title: '', items: [] }
  }
  return { outcome: 'online', tone: 'green', proceed: true, title: '', items: [] }
}

/**
 * Idle GO color, before the driver taps.
 * Green when documents and inspection are clear and they can go online.
 * Orange when files are missing, unapproved, overdue, or the application is on hold.
 */
export function idleGoTone({ documents, dueAt, now = new Date(), canGoOnline = false } = {}) {
  const decision = decideGoPress({ goingOnline: true, documents, dueAt, now, canGoOnline })
  return decision.tone === 'green' ? 'green' : 'orange'
}
