/**
 * Payment method, quote, checkout, credit, and trip-settlement actions.
 * POST /api/stripe-payment-methods?action=setup-intent|save|quote|airport-checkout|buy-credits|credits-confirm|collect|settle|credits|credit-lots
 * GET  /api/stripe-payment-methods?action=credit-lots|credits
 * Legacy paths are rewritten in vercel.json.
 * Body sub-actions such as buy (prepaid credits) are not route names.
 */
import { cors, json } from '../server/friendRideLib.js'
import { resolveRouteAction } from '../server/routeAction.js'
import {
  handleStripeSavePaymentMethod,
  handleStripeSetupIntent,
} from '../server/stripePaymentRoutes.js'
import handleQuoteFare from '../server/endpoints/quoteFare.js'
import handleAirportCheckout from '../server/endpoints/airportCheckout.js'
import handleBuyCredits from '../server/endpoints/buyCredits.js'
import handleCreditsConfirm from '../server/endpoints/creditsConfirm.js'
import handleCreditLots from '../server/endpoints/creditLots.js'
import handlePrepaidCredits from '../server/endpoints/prepaidCredits.js'
import handleCollectPayment from '../server/endpoints/collectPayment.js'
import handleTripSettle from '../server/endpoints/tripSettle.js'

const HANDLERS = {
  'setup-intent': handleStripeSetupIntent,
  save: handleStripeSavePaymentMethod,
  quote: handleQuoteFare,
  'airport-checkout': handleAirportCheckout,
  'buy-credits': handleBuyCredits,
  'credits-confirm': handleCreditsConfirm,
  'credit-lots': handleCreditLots,
  credits: handlePrepaidCredits,
  collect: handleCollectPayment,
  settle: handleTripSettle,
}

const LEGACY = {
  'stripe-setup-intent': 'setup-intent',
  'stripe-save-payment-method': 'save',
  'quote-fare': 'quote',
  'airport-checkout': 'airport-checkout',
  'buy-credits': 'buy-credits',
  'credits-confirm': 'credits-confirm',
  'collect-payment': 'collect',
  'trip-settle': 'settle',
}

export default async function handler(req, res) {
  if (cors(req, res)) return
  const action = resolveRouteAction(req, { allowed: Object.keys(HANDLERS), legacy: LEGACY })
  const handle = HANDLERS[action]
  if (!handle) {
    return json(res, 400, {
      error: 'Unknown payment action. Use action=setup-intent, save, quote, airport-checkout, buy-credits, credits-confirm, credit-lots, credits, collect, or settle.',
    })
  }
  return handle(req, res)
}
