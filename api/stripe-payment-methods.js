/**
 * Payment method, quote, checkout, credit, and trip-settlement actions.
 * POST /api/stripe-payment-methods?action=setup-intent|save|quote|airport-checkout|schedule-trip|request-driver|buy-credits|credits-confirm|abandon-checkout|collect|settle|credits|credit-lots|clemson-miami
 * GET  /api/stripe-payment-methods?action=credit-lots|credits
 * Legacy paths are rewritten in vercel.json.
 * Body sub-actions such as buy (prepaid credits) are not route names.
 */
import { cors, json } from '../server/friendRideLib.js'
import { peekJsonBody, resolveRouteAction } from '../server/routeAction.js'
import {
  handleListSavedPaymentMethods,
  handleStripeSavePaymentMethod,
  handleStripeSetupIntent,
  handleUpdateSavedPaymentMethod,
} from '../server/stripePaymentRoutes.js'
import handleQuoteFare from '../server/endpoints/quoteFare.js'
import handleAirportCheckout from '../server/endpoints/airportCheckout.js'
import handleBuyCredits from '../server/endpoints/buyCredits.js'
import handleCreditsConfirm from '../server/endpoints/creditsConfirm.js'
import handleCreditLots from '../server/endpoints/creditLots.js'
import handlePrepaidCredits from '../server/endpoints/prepaidCredits.js'
import handleCollectPayment from '../server/endpoints/collectPayment.js'
import handleTripSettle from '../server/endpoints/tripSettle.js'
import handleScheduleTrip from '../server/endpoints/scheduleTrip.js'
import handleRequestDriverTrip from '../server/endpoints/requestDriverTrip.js'
import handleAbandonCheckout from '../server/endpoints/abandonCheckout.js'
import handleReconcileCheckout from '../server/endpoints/reconcileCheckout.js'
import handleClemsonMiamiCheckout from '../server/endpoints/clemsonMiamiCheckout.js'
import handleRideBilling from '../server/endpoints/rideBilling.js'
import handleRideOptions from '../server/endpoints/rideOptions.js'
import handleScheduleSlots from '../server/endpoints/scheduleSlots.js'
import handleMatchNotice from '../server/endpoints/matchNotice.js'
import handleTigerPass from '../server/endpoints/tigerPass.js'
import handleFavoriteDrivers from '../server/endpoints/favoriteDrivers.js'
import handleScheduledRider from '../server/endpoints/scheduledRider.js'

const HANDLERS = {
  'setup-intent': handleStripeSetupIntent,
  save: handleStripeSavePaymentMethod,
  quote: handleQuoteFare,
  'airport-checkout': handleAirportCheckout,
  'schedule-trip': handleScheduleTrip,
  'request-driver': handleRequestDriverTrip,
  'buy-credits': handleBuyCredits,
  'credits-confirm': handleCreditsConfirm,
  'abandon-checkout': handleAbandonCheckout,
  'credit-lots': handleCreditLots,
  credits: handlePrepaidCredits,
  collect: handleCollectPayment,
  settle: handleTripSettle,
  'reconcile-checkout': handleReconcileCheckout,
  'clemson-miami': handleClemsonMiamiCheckout,
  billing: handleRideBilling,
  'ride-options': handleRideOptions,
  'schedule-slots': handleScheduleSlots,
  'match-notice': handleMatchNotice,
  'tiger-pass': handleTigerPass,
  'favorite-drivers': handleFavoriteDrivers,
  'scheduled-rider': handleScheduledRider,
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

export default async function handler(req, res, ...rest) {
  if (cors(req, res)) return
  const action = resolveRouteAction(req, { allowed: Object.keys(HANDLERS), legacy: LEGACY })
  if (!action) {
    const body = peekJsonBody(req)
    const sub = typeof body?.action === 'string' ? body.action : ''
    if (req.method === 'GET') return handleListSavedPaymentMethods(req, res)
    if (req.method === 'POST' && (sub === 'default' || sub === 'detach')) {
      return handleUpdateSavedPaymentMethod(req, res)
    }
  }
  const handle = HANDLERS[action]
  if (!handle) {
    return json(res, 400, {
      error: 'Unknown payment action. Use action=setup-intent, save, quote, airport-checkout, schedule-trip, schedule-slots, match-notice, request-driver, buy-credits, credits-confirm, abandon-checkout, credit-lots, credits, collect, settle, reconcile-checkout, clemson-miami, billing, ride-options, tiger-pass, favorite-drivers, or scheduled-rider.',
    })
  }
  return handle(req, res, ...rest)
}
