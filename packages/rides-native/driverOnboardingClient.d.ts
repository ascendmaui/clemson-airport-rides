export const IC_AGREEMENT_TITLE: string
export const IC_AGREEMENT_VERSION: string
export const ONBOARDING_FLOW: { id: string; label: string; kind: string; docIds: string[] }[]
export const REQUIRED_DOCUMENTS: { id: string; label: string; hint: string; stepId: string }[]
export const TAX_CLASSIFICATIONS: { id: string; label: string }[]
export const WORK_ELIGIBILITY_CATEGORIES: { id: string; label: string }[]

export function blockerLabel(code: string): string
export function canOpenStep(stepId: string, ctx?: Record<string, unknown>): boolean
export function displayTinLast4(value: string | null | undefined): string
export function flowStep(stepId: string): { id: string; label: string; kind: string; docIds: string[] } | null
export function onboardingLabel(status: string | null | undefined): string
export function progressSnapshot(ctx?: Record<string, unknown>): {
  total: number
  index: number
  stepNumber: number
  percent: number
  label: string
  submitted: boolean
}
export function stepIsComplete(stepId: string, ctx?: Record<string, unknown>): boolean
export function submissionBlockers(ctx?: Record<string, unknown>): string[]
export function agreementPlainText(html?: string): string

export type OnboardingBundle = {
  application: Record<string, unknown> | null
  documents: { id?: string; doc_type: string; storage_path?: string }[]
  tax: { legal_name?: string; tin_last4?: string; tax_classification?: string } | null
  agreement: { signature_name?: string; signed_at?: string; agreement_version?: string } | null
  ctx: Record<string, unknown>
  stepId: string
  blockers: string[]
  progress: { percent: number; label: string; stepNumber: number; total: number; submitted: boolean }
}

export function loadOnboarding(supabase: unknown, userId: string): Promise<OnboardingBundle>
export function uploadDriverDocument(
  supabase: unknown,
  userId: string,
  docType: string,
  file: { uri: string; name?: string; mimeType?: string; size?: number },
): Promise<{ doc_type: string; storage_path: string }>
export function saveDriverInfo(supabase: unknown, user: { id: string; email?: string | null }, payload: Record<string, unknown>): Promise<Record<string, unknown>>
export function saveEmploymentVerification(
  supabase: unknown,
  userId: string,
  input: { backgroundAuthorized: boolean; category: string },
): Promise<unknown>
export function saveDriverTaxInfo(
  supabase: unknown,
  input: { legalName: string; tin: string; taxClassification: string },
): Promise<{ legal_name?: string; tin_last4?: string; tax_classification?: string }>
export function signDriverAgreement(supabase: unknown, signatureName: string): Promise<unknown>
export function submitDriverReview(supabase: unknown, userId: string): Promise<Record<string, unknown>>

export type ApplicantInboxMessage = { id: string; author_role: string; kind?: string; body: string }
export type ApplicantInboxRequest = { id: string; prompt: string; status: string }
export type ApplicantInbox = { messages?: ApplicantInboxMessage[]; requests?: ApplicantInboxRequest[] }
export function loadApplicantInbox(supabase: unknown): Promise<ApplicantInbox>
export function replyApplicantInbox(supabase: unknown, body: string): Promise<ApplicantInbox>
