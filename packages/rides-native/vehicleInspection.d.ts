import type { CategoryAttention, CategorySlot, DocumentRow } from './documentCategories.js'

export const INSPECTION_TAB_LABEL: string
export const INSPECTION_OVERDUE_COPY: string
export const INSPECTION_FORM_TYPE: string

export type InspectionSourceId = 'lyft' | 'uber' | 'other_platform' | 'independent'

export type InspectionSource = {
  id: InspectionSourceId
  label: string
}

export const INSPECTION_SOURCES: InspectionSource[]

export type InspectionSlotSpec = {
  id: string
  label: string
  hint: string
  required: boolean
  kind: 'photo' | 'form'
}

export const INSPECTION_SLOTS: InspectionSlotSpec[]

export function isInspectionDocType(docType: string): boolean
export function isInspectionSource(value: string | null | undefined): boolean
export function inspectionDueCopy(days: number): string
export function inspectionSubmitted(documents?: DocumentRow[] | null): boolean
export function inspectionAttention(documents?: DocumentRow[] | null): CategoryAttention
export function inspectionSlots(documents?: DocumentRow[] | null): CategorySlot[]

export type InspectionCountdown = {
  days: number
  message: string
}

export function inspectionCountdown(input: {
  documents?: DocumentRow[] | null
  dueAt?: string | Date | null
  now?: string | Date
}): InspectionCountdown | null

export type InspectionGoOnlineGate = {
  allowed: boolean
  message: string
}

export function inspectionGoOnlineGate(input: {
  documents?: DocumentRow[] | null
  dueAt?: string | Date | null
  now?: string | Date
}): InspectionGoOnlineGate
