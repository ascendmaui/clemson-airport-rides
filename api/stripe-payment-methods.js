/**
 * POST /api/stripe-payment-methods?action=setup-intent|save
 * Legacy /api/stripe-setup-intent and /api/stripe-save-payment-method are rewritten here.
 * stripe-webhook stays its own function.
 */
import { cors, json } from '../server/friendRideLib.js'
import { resolveRouteAction } from '../server/routeAction.js'
import {
  handleStripeSavePaymentMethod,
  handleStripeSetupIntent,
} from '../server/stripePaymentRoutes.js'

const HANDLERS = {
  'setup-intent': handleStripeSetupIntent,
  save: handleStripeSavePaymentMethod,
}

const LEGACY = {
  'stripe-setup-intent': 'setup-intent',
  'stripe-save-payment-method': 'save',
}

export default async function handler(req, res) {
  if (cors(req, res)) return
  const action = resolveRouteAction(req, { allowed: Object.keys(HANDLERS), legacy: LEGACY })
  const handle = HANDLERS[action]
  if (!handle) {
    return json(res, 400, {
      error: 'Unknown payment method action. Use action=setup-intent or action=save.',
    })
  }
  return handle(req, res)
}
