export interface CheckoutReturn {
  sessionId: string | null
  tripId: string | null
  paid: boolean
  canceled: boolean
  scheduled: boolean
}

export function parseCheckoutSessionId(input: unknown): string | null

export function parseCheckoutReturn(input: unknown): CheckoutReturn
