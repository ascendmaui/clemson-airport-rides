/**
 * POST /api/driver?action=signup|submit-review|offer-preview|tip|wait|cancel-midride|payouts
 * GET  /api/driver?action=earnings|payouts
 * Legacy paths are rewritten in vercel.json.
 * trip-wait body.action (arrive|tick|cancel|start|complete) is a sub-action, not the route.
 */
import { cors, json } from '../server/friendRideLib.js'
import { resolveRouteAction } from '../server/routeAction.js'
import { handleDriverSignup, handleDriverSubmitReview } from '../server/driverRoutes.js'
import handleDriverEarnings from '../server/endpoints/driverEarnings.js'
import handleOfferPreview from '../server/endpoints/tripOfferPreview.js'
import handleTripTip from '../server/endpoints/tripTip.js'
import handleTripWait from '../server/endpoints/tripWait.js'
import handleCancelMidride from '../server/endpoints/tripCancelMidride.js'
import handleDriverPayouts from '../server/endpoints/driverPayouts.js'

const HANDLERS = {
  signup: handleDriverSignup,
  'submit-review': handleDriverSubmitReview,
  earnings: handleDriverEarnings,
  'offer-preview': handleOfferPreview,
  tip: handleTripTip,
  wait: handleTripWait,
  'cancel-midride': handleCancelMidride,
  payouts: handleDriverPayouts,
}

const LEGACY = {
  'driver-signup': 'signup',
  'driver-submit-review': 'submit-review',
  'driver-earnings': 'earnings',
  'trip-offer-preview': 'offer-preview',
  'trip-tip': 'tip',
  'trip-wait': 'wait',
  'trip-cancel-midride': 'cancel-midride',
  'driver-payouts': 'payouts',
}

export default async function handler(req, res) {
  if (cors(req, res)) return
  const action = resolveRouteAction(req, { allowed: Object.keys(HANDLERS), legacy: LEGACY })
  const handle = HANDLERS[action]
  if (!handle) {
    return json(res, 400, {
      error: 'Unknown driver action. Use action=signup, submit-review, earnings, offer-preview, tip, wait, cancel-midride, or payouts.',
    })
  }
  return handle(req, res)
}
