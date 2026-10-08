/**
 * GET /api/tiger-heat?window=now|weekday_am|friday_night|last_7d
 * Live window: payable zones from recent pickup density, after solvency.
 * Other windows: preview heat maps. Preview does not reserve driver pay.
 */
import { admin, cors, json } from '../server/friendRideLib.js'
import { buildTigerHeatMap } from '../server/tigerHeatService.js'

function windowIdFrom(req) {
  const fromQuery = req.query?.window
  if (typeof fromQuery === 'string' && fromQuery) return fromQuery
  try {
    const url = new URL(req.url || '/', 'http://localhost')
    return url.searchParams.get('window') || 'now'
  } catch {
    return 'now'
  }
}

export default async function handler(req, res, deps = {}) {
  if (cors(req, res)) return
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json(res, 405, { error: 'Method not allowed' })
  }
  const body = await buildTigerHeatMap({
    sb: deps.sb !== undefined ? deps.sb : admin(),
    windowId: windowIdFrom(req),
  })
  if (req.method === 'HEAD') {
    res.statusCode = 200
    res.end()
    return
  }
  return json(res, 200, body)
}
