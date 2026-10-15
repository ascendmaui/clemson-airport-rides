export type GoTone = 'orange' | 'purple' | 'green'

export type GoOutcome = 'offline' | 'attention' | 'hold' | 'online'

export type AttentionReason = 'Missing' | 'Needs approval' | 'Rejected' | 'Overdue'

export type AttentionItem = {
  id: string
  label: string
  section: string
  reason: AttentionReason
}

export type AttentionRequired = {
  items: AttentionItem[]
  documentsAllowed: boolean
  inspectionAllowed: boolean
  title: string
}

export type GoDecision = {
  outcome: GoOutcome
  tone: GoTone
  proceed: boolean
  title: string
  items: AttentionItem[]
}

export function attentionRequiredItems(input: {
  documents?: unknown[] | null
  dueAt?: unknown
  now?: Date
}): AttentionRequired

export function attentionScreenItems(input: {
  documents?: unknown[] | null
  dueAt?: unknown
  now?: Date
}): AttentionRequired

export function decideGoPress(input: {
  goingOnline: boolean
  documents?: unknown[] | null
  dueAt?: unknown
  now?: Date
  canGoOnline?: boolean
}): GoDecision

export function idleGoTone(input?: {
  documents?: unknown[] | null
  dueAt?: unknown
  now?: Date
  canGoOnline?: boolean
}): 'green' | 'orange'
