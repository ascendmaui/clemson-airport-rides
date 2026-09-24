export const QUIZ_PASS_PERCENT: number
export const QUIZ_MAX_MISSES: number

export type KnowledgeChoice = { id: string; label: string }

export type KnowledgeQuestion = {
  id: string
  prompt: string
  choices: KnowledgeChoice[]
  answerId: string
}

export type StudyNote = { id: string; title: string; body: string }

export type KnowledgeGrade = {
  correct: number
  total: number
  score: number
  missed: string[]
  passed: boolean
}

export type KnowledgeQuizRow = {
  quiz_score: number | null
  quiz_passed_at: string | null
  quiz_attempted_at: string | null
  onboarding_status?: string | null
}

export type KnowledgeQuizStatus = 'not_started' | 'failed' | 'passed'

export const KNOWLEDGE_QUIZ: KnowledgeQuestion[]
export const STUDY_NOTES: StudyNote[]

export function knowledgeQuizPassed(correct: number, total: number): boolean
export function gradeKnowledgeQuiz(selections?: Record<string, string | null | undefined>): KnowledgeGrade
export function knowledgeQuizStatus(row: KnowledgeQuizRow | null | undefined): KnowledgeQuizStatus
export function knowledgeQuizStatusLabel(status: KnowledgeQuizStatus): string
export function normalizeQuizRow(data: Record<string, unknown> | null | undefined): KnowledgeQuizRow | null
export function loadKnowledgeQuiz(
  supabase: unknown,
  userId: string,
): Promise<{ row: KnowledgeQuizRow | null; error: string | null }>
export function saveKnowledgeQuiz(
  supabase: unknown,
  userId: string,
  grade: Pick<KnowledgeGrade, 'score' | 'passed'>,
): Promise<{ row: KnowledgeQuizRow | null; error: string | null }>
