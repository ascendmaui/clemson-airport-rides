export const ATTENTION_COPY: string

export type DocumentCategoryId = 'license' | 'insurance' | 'registration' | 'vehicle'

export type DocumentCategory = {
  id: DocumentCategoryId
  label: string
  stepId: string
  docTypes: string[]
}

export type DocumentRow = {
  doc_type?: string | null
  type?: string | null
  storage_path?: string | null
  review_status?: string | null
  review_note?: string | null
  match_status?: string | null
  created_at?: string | null
  id?: string | null
}

export type CategoryAttention = {
  approved: boolean
  mark: 'check' | 'x'
  label: string
}

export type CategorySlot = {
  id: string
  label: string
  hint: string
  row: DocumentRow | null
  uploaded: boolean
  action: 'upload' | 'replace'
}

export const DOCUMENT_CATEGORIES: DocumentCategory[]

export function documentType(row: DocumentRow | null | undefined): string
export function categoryForDocument(row: DocumentRow | null | undefined): DocumentCategory | null
export function isDocumentApproved(row: DocumentRow | null | undefined): boolean
export function categoryAttention(categoryId: string, documents?: DocumentRow[] | null): CategoryAttention

export const DOCUMENTS_GO_ONLINE_COPY: string

export type GoOnlineSection = {
  id: string
  label: string
}

export type GoOnlineDocumentGate = {
  allowed: boolean
  sections: GoOnlineSection[]
  message: string
}

export function goOnlineDocumentGate(documents?: DocumentRow[] | null): GoOnlineDocumentGate
export function guardGoPress(input: {
  goingOnline: boolean
  documents?: DocumentRow[] | null
}): { proceed: boolean; message: string; sections: GoOnlineSection[] }

export function categorySlots(categoryId: string, documents?: DocumentRow[] | null): CategorySlot[]
