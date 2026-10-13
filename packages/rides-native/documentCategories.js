/**
 * Driver document tabs. Rows are grouped by the existing doc_type
 * (with `type` accepted when that is the only field present).
 * Category approval lives here so the tab header and the section
 * share one rule, and so photo review can call the same helper.
 */
import { REQUIRED_DOCUMENTS } from '../../shared/driverOnboarding.js'

const TABS = [
  { id: 'license', label: "Driver's License", stepId: 'license' },
  { id: 'insurance', label: 'Insurance', stepId: 'insurance' },
  { id: 'registration', label: 'Registration', stepId: 'registration' },
  { id: 'vehicle', label: 'Vehicle Photos', stepId: 'car' },
]

export const ATTENTION_COPY = 'Needs your attention'

export const DOCUMENT_CATEGORIES = TABS.map((tab) => ({
  ...tab,
  docTypes: REQUIRED_DOCUMENTS.filter((doc) => doc.stepId === tab.stepId).map((doc) => doc.id),
}))

export function documentType(row) {
  if (!row || typeof row !== 'object') return ''
  const raw = row.doc_type ?? row.type ?? ''
  return String(raw).trim()
}

export function categoryForDocument(row) {
  const type = documentType(row)
  if (!type) return null
  return DOCUMENT_CATEGORIES.find((category) => category.docTypes.includes(type)) || null
}

export function isDocumentApproved(row) {
  return String(row?.review_status ?? '').trim() === 'approved'
}

function indexDocuments(documents) {
  const indexed = new Map()
  for (const row of documents || []) {
    const type = documentType(row)
    if (type) indexed.set(type, row)
  }
  return indexed
}

function attention(approved) {
  if (approved) return { approved: true, mark: 'check', label: 'Approved' }
  return { approved: false, mark: 'x', label: ATTENTION_COPY }
}

/** Check only when every required document in the category is approved. */
export function categoryAttention(categoryId, documents) {
  const category = DOCUMENT_CATEGORIES.find((item) => item.id === categoryId) || null
  if (!category || category.docTypes.length === 0) return attention(false)
  const indexed = indexDocuments(documents)
  const approved = category.docTypes.every((type) => isDocumentApproved(indexed.get(type)))
  return attention(approved)
}

export const DOCUMENTS_GO_ONLINE_COPY = 'Your documents need approval before you can go online'

/**
 * Go-online is allowed only when categoryAttention is approved for every tab.
 * Admins and demo cars are not skipped: today's go-online write does not exempt them.
 */
export function goOnlineDocumentGate(documents) {
  const sections = DOCUMENT_CATEGORIES
    .filter((category) => !categoryAttention(category.id, documents).approved)
    .map((category) => ({ id: category.id, label: category.label }))
  if (sections.length === 0) return { allowed: true, sections: [], message: '' }
  return { allowed: false, sections, message: DOCUMENTS_GO_ONLINE_COPY }
}

/** Call this before the GO handler. Ending a shift is never blocked here. */
export function guardGoPress({ goingOnline, documents }) {
  if (!goingOnline) return { proceed: true, message: '', sections: [] }
  const gate = goOnlineDocumentGate(documents)
  if (gate.allowed) return { proceed: true, message: '', sections: [] }
  return { proceed: false, message: gate.message, sections: gate.sections }
}

export function categorySlots(categoryId, documents) {
  const category = DOCUMENT_CATEGORIES.find((item) => item.id === categoryId) || null
  if (!category) return []
  const indexed = indexDocuments(documents)
  return category.docTypes.map((type) => {
    const spec = REQUIRED_DOCUMENTS.find((doc) => doc.id === type)
    const row = indexed.get(type) || null
    const uploaded = Boolean(row?.storage_path)
    return {
      id: type,
      label: spec?.label || type,
      hint: spec?.hint || '',
      row,
      uploaded,
      action: uploaded ? 'replace' : 'upload',
    }
  })
}
