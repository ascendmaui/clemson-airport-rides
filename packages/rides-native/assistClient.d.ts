export type AgentTicketDraft = {
  ready?: boolean
  category?: string
  subject?: string
  body?: string
}

export type AgentHttpResult = {
  reply: string
  actions: unknown[]
  source: string
  notice: string | null
  roleVariant?: string
  contextSummary: string | null
  ticketDraft: AgentTicketDraft | null
  redactedUserText: string | null
}

export function parseAgentHttpResponse(input: {
  ok?: boolean
  status?: number
  contentType?: string | null
  metaHeader?: string | null
  text?: string | null
}): AgentHttpResult

export function postAgent(input: {
  url: string
  headers: Record<string, string>
  body: unknown
}): Promise<AgentHttpResult>

export function supportTicketRequest(input: {
  url: string
  headers: Record<string, string>
  method?: string
  body?: unknown
}): Promise<{ ticket?: { id?: string }; error?: string }>
