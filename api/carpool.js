/**
 * POST /api/carpool?action=match|group|program|attribute
 * Also /api/carpool/:action and legacy /api/carpool-match|group|program (rewritten).
 * body.action on the program route stays ambassador | first_ride.
 * attribute stores /a/:code on the signed-in rider and does not write a payout.
 */
import { cors, json } from '../server/friendRideLib.js'
import { resolveRouteAction } from '../server/routeAction.js'
import {
  handleCarpoolAttribute,
  handleCarpoolGroup,
  handleCarpoolMatch,
  handleCarpoolProgram,
} from '../server/carpoolRoutes.js'

const HANDLERS = {
  match: handleCarpoolMatch,
  group: handleCarpoolGroup,
  program: handleCarpoolProgram,
  attribute: handleCarpoolAttribute,
}

const LEGACY = {
  'carpool-match': 'match',
  'carpool-group': 'group',
  'carpool-program': 'program',
}

export default async function handler(req, res) {
  if (cors(req, res)) return
  const action = resolveRouteAction(req, { allowed: Object.keys(HANDLERS), legacy: LEGACY })
  const handle = HANDLERS[action]
  if (!handle) {
    return json(res, 400, {
      error: 'Unknown carpool action. Use action=match, action=group, action=program, or action=attribute.',
    })
  }
  return handle(req, res)
}
