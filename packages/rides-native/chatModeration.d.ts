export const CHAT_REPORT_REASONS: readonly string[]
export const CHAT_REPORT_CONFIRMATION: string
export const CHAT_SUPPORT_COPY: string
export const CHAT_BLOCK_COPY: string
export type ChatModerationInput = {
  tripId: string
  roleVariant: 'rider' | 'driver'
  reportedRole: 'rider' | 'driver'
  reportedUserId?: string | null
  reason?: string
  message?: { id: string; body: string } | null
  action?: 'report' | 'block'
}
export function buildChatModerationTicket(input: ChatModerationInput): {
  confirmed: true
  category: 'safety'
  roleVariant: 'rider' | 'driver'
  subject: string
  body: string
}
export function chatBlockKey(userId: string, otherUserId: string): string
export function createChatBlockStore(storage: {
  getItem(key: string): string | null | Promise<string | null>
  setItem(key: string, value: string): void | Promise<void>
  removeItem(key: string): void | Promise<void>
}): {
  isBlocked(userId: string, otherUserId: string): Promise<boolean>
  setBlocked(userId: string, otherUserId: string, blocked: boolean): Promise<void>
  subscribe(listener: (key: string, blocked: boolean) => void): () => void
}
