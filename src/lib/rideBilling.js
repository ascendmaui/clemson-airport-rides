import { api } from './payments.js'

const CLIENT_MONEY_KEYS = [
  'fareCents',
  'fare_cents',
  'fare',
  'depositCents',
  'deposit_cents',
  'deposit',
  'amount',
  'amountCents',
  'amount_cents',
  'total',
  'totalCents',
  'total_cents',
  'isStudent',
  'is_student',
]

function placesOnly(body) {
  const next = { ...(body || {}) }
  for (const key of CLIENT_MONEY_KEYS) delete next[key]
  return next
}

export function fetchBillingQuote(body) {
  return api('/api/stripe-payment-methods?action=billing', { mode: 'quote', ...placesOnly(body) })
}

export function recordBillingChoice(body) {
  return api('/api/stripe-payment-methods?action=billing', {
    mode: 'record',
    ...placesOnly(body),
    choice: body?.choice,
    billingChoice: body?.choice,
  })
}
