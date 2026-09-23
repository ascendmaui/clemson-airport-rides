/**
 * POST /api/driver?action=signup|submit-review
 * Legacy /api/driver-signup and /api/driver-submit-review are rewritten here.
 */
import { cors, json } from '../server/friendRideLib.js'
import { resolveRouteAction } from '../server/routeAction.js'
import { handleDriverSignup, handleDriverSubmitReview } from '../server/driverRoutes.js'

const HANDLERS = {
  signup: handleDriverSignup,
  'submit-review': handleDriverSubmitReview,
}

const LEGACY = {
  'driver-signup': 'signup',
  'driver-submit-review': 'submit-review',
}

export default async function handler(req, res) {
  if (cors(req, res)) return
  const action = resolveRouteAction(req, { allowed: Object.keys(HANDLERS), legacy: LEGACY })
  const handle = HANDLERS[action]
  if (!handle) {
    return json(res, 400, {
      error: 'Unknown driver action. Use action=signup or action=submit-review.',
    })
  }
  return handle(req, res)
}
