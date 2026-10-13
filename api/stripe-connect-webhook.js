/**
 * POST /api/stripe-connect-webhook
 * Connect events (account.updated, transfer.*, payout.*) for affiliate Express accounts.
 * Uses STRIPE_CONNECT_WEBHOOK_SECRET when set, otherwise the main STRIPE_WEBHOOK_SECRET.
 * Test mode only: live-mode events are acknowledged and not applied.
 */
import handler from './stripe-webhook.js'

export const config = { api: { bodyParser: false } }

export default function connectWebhook(req, res) {
  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET || ''
  return handler(req, res, { webhookSecret: secret })
}
