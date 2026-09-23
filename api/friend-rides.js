/**
 * Friend-ride routes in one Serverless Function.
 * /api/friend-rides?action=create|get|join|recompute|confirm-charges|retry-charge
 * GET with ?token= and no action is treated as get.
 * Legacy /api/friend-rides-* paths are rewritten here.
 */
import { cors, json } from '../server/friendRideLib.js'
import { requestUrl, resolveRouteAction } from '../server/routeAction.js'
import {
  handleFriendRideConfirmCharges,
  handleFriendRideCreate,
  handleFriendRideGet,
  handleFriendRideJoin,
  handleFriendRideRecompute,
  handleFriendRideRetryCharge,
} from '../server/friendRideRoutes.js'

const HANDLERS = {
  create: handleFriendRideCreate,
  get: handleFriendRideGet,
  join: handleFriendRideJoin,
  recompute: handleFriendRideRecompute,
  'confirm-charges': handleFriendRideConfirmCharges,
  'retry-charge': handleFriendRideRetryCharge,
}

const LEGACY = {
  'friend-rides-create': 'create',
  'friend-rides-get': 'get',
  'friend-rides-join': 'join',
  'friend-rides-recompute': 'recompute',
  'friend-rides-confirm-charges': 'confirm-charges',
  'friend-rides-retry-charge': 'retry-charge',
}

function tokenPresent(req) {
  const url = requestUrl(req)
  if (url.searchParams.get('token')) return true
  const queryToken = req.query?.token
  if (typeof queryToken === 'string' && queryToken) return true
  if (Array.isArray(queryToken) && queryToken[0]) return true
  return false
}

export default async function handler(req, res) {
  if (cors(req, res)) return
  let action = resolveRouteAction(req, { allowed: Object.keys(HANDLERS), legacy: LEGACY })
  if (!action && req.method === 'GET' && tokenPresent(req)) action = 'get'
  const handle = HANDLERS[action]
  if (!handle) {
    return json(res, 400, {
      error: 'Unknown friend ride action. Use action=create, get, join, recompute, confirm-charges, or retry-charge.',
    })
  }
  return handle(req, res)
}
