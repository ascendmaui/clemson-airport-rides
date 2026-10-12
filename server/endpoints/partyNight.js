/**
 * POST/GET /api/party-night?action=explain|quote|create|get|join|leave|cancel|reminders|return-join|return-leave|return-queue
 */
import { admin, json, parseBody, userFromAuth } from '../friendRideLib.js'
import { resolveRouteAction } from '../routeAction.js'
import { supabasePartyRepo } from '../partyNightRepo.js'
import { quotePartyNight } from '../../shared/partyNight.js'
import {
  cancelPartyNight,
  createPartyNight,
  explainPartyNight,
  getPartyNight,
  joinPartyNight,
  joinReturnQueue,
  leavePartyNight,
  leaveReturnQueue,
  partyReminders,
  returnQueueView,
} from '../partyNightService.js'

export const PARTY_NIGHT_ACTIONS = [
  'explain',
  'quote',
  'create',
  'get',
  'join',
  'leave',
  'cancel',
  'reminders',
  'return-join',
  'return-leave',
  'return-queue',
]

const PUBLIC = new Set(['explain', 'quote', 'get', 'return-queue'])

function missingTable(error) {
  return /relation|does not exist|schema cache/i.test(error?.message || '')
}

function readToken(req, body) {
  if (body?.token) return String(body.token)
  const raw = req?.url || '/'
  try {
    const url = new URL(raw, 'http://localhost')
    return url.searchParams.get('token') || req?.query?.token || ''
  } catch {
    return req?.query?.token || ''
  }
}

export async function handlePartyNight(req, res, deps = {}) {
  if (req.method === 'OPTIONS') return json(res, 204, {})
  if (req.method !== 'POST' && req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' })
  const action = resolveRouteAction(req, { allowed: PARTY_NIGHT_ACTIONS })
  if (!action) return json(res, 400, { error: 'Unknown party night action.' })

  const parsed = req.method === 'POST' ? parseBody(req) : { body: {} }
  if (parsed.error) return json(res, 400, { error: parsed.error })
  const body = parsed.body || {}
  const token = readToken(req, body)
  const now = deps.now ? new Date(deps.now) : new Date()

  if (action === 'explain') return json(res, 200, explainPartyNight())
  if (action === 'quote') {
    const quote = quotePartyNight(body)
    return json(res, quote.ok ? 200 : 400, quote)
  }

  const user = deps.user !== undefined ? deps.user : await userFromAuth(req)
  if (!PUBLIC.has(action) && !user) return json(res, 401, { error: 'Sign in required' })

  const repo = deps.repo !== undefined ? deps.repo : (admin() ? supabasePartyRepo(admin()) : null)
  if (!repo) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  try {
    let result
    if (action === 'create') {
      result = await createPartyNight(repo, {
        user,
        pickup: body.pickup,
        dropoff: body.dropoff,
        date: body.date,
        time: body.time,
        displayName: body.displayName,
        returnOptIn: body.returnOptIn,
        now,
      })
    } else if (action === 'get') {
      result = await getPartyNight(repo, { token, viewerId: user?.id || null, now })
    } else if (action === 'join') {
      result = await joinPartyNight(repo, { user, token, displayName: body.displayName, now })
    } else if (action === 'leave') {
      result = await leavePartyNight(repo, { user, token, now })
    } else if (action === 'cancel') {
      result = await cancelPartyNight(repo, { user, token, now })
    } else if (action === 'reminders') {
      result = await partyReminders(repo, { user, now })
    } else if (action === 'return-join') {
      result = await joinReturnQueue(repo, {
        user,
        pickup: body.pickup,
        dropoff: body.dropoff,
        partyNightId: body.partyNightId || null,
        displayName: body.displayName,
        now,
      })
    } else if (action === 'return-leave') {
      result = await leaveReturnQueue(repo, { user, now })
    } else if (action === 'return-queue') {
      result = await returnQueueView(repo, { user, now })
    } else {
      const unknown = action
      return json(res, 400, { error: `Unknown party night action: ${unknown}` })
    }
    const status = result.status || (result.ok === false ? 400 : 200)
    return json(res, status, result)
  } catch (err) {
    if (missingTable(err)) {
      return json(res, 503, {
        error: 'Party night scheduling is not available until the latest database migration is applied.',
        code: 'schema_missing',
      })
    }
    console.error('[party-night]', err)
    return json(res, 500, { error: err.message || 'Party night request failed' })
  }
}
