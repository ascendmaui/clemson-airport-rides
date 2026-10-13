/**
 * What happens when a driver taps GO.
 * Ending a shift is never blocked. Going online turns green only when every
 * required document is approved and the inspection is not overdue. Otherwise
 * the button turns orange and the driver sees the exact files still required.
 */
import {
  ATTENTION_COPY,
  DOCUMENT_CATEGORIES,
  categorySlots,
  goOnlineDocumentGate,
  isDocumentApproved,
} from './documentCategories.js'
import {
  INSPECTION_FORM_TYPE,
  INSPECTION_SLOTS,
  INSPECTION_TAB_LABEL,
  inspectionGoOnlineGate,
  inspectionSlots,
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
