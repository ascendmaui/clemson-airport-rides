export const ACCOUNT_DELETION_TICKET: {
  readonly confirmed: true
  readonly category: 'account'
  readonly roleVariant: 'rider'
  readonly subject: string
  readonly body: string
}

export function buildAccountDeletionTicket(options?: {
  email?: string | null
  roleVariant?: 'rider' | 'driver'
  subject?: string
}): {
  confirmed: true
  category: 'account'
  roleVariant: 'rider' | 'driver'
  subject: string
  body: string
}
