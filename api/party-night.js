/**
 * POST /api/party-night?action=explain|quote|create|get|join|leave|cancel|reminders|return-join|return-leave|return-queue
 */
import { cors } from '../server/friendRideLib.js'
import { handlePartyNight } from '../server/endpoints/partyNight.js'

export default async function handler(req, res, ...rest) {
  if (cors(req, res)) return
  return handlePartyNight(req, res, ...rest)
}
