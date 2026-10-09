/**
 * POST or GET /api/stripe-payment-methods?action=schedule-slots
 * Current wait from available drivers, then pickup slots 10 to 15 minutes out.
 * Demo drivers are excluded. No driver names are returned.
 */
import { isE2ETestUser } from '../../shared/e2eTestAccounts.js'
import { admin, cors, json, parseBody, userFromAuth } from '../friendRideLib.js'
import { loadNearTermOffer } from '../nearTermAvailability.js'

function pickupFrom(body) {
  const source = body?.pickup && typeof body.pickup === 'object' ? body.pickup : body
  const lat = Number(source?.lat ?? source?.pickupLat)
  const lng = Number(source?.lng ?? source?.pickupLng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  const label = String(source?.label || source?.pickupLabel || '').trim().slice(0, 160)
  return { label, lat, lng }
}

export default async function handler(req, res, deps = {}) {
  if (cors(req, res)) return
  if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  const sb = deps.sb || admin()
  const user = deps.user !== undefined ? deps.user : await userFromAuth(req)
  const now = deps.now instanceof Date ? deps.now : new Date()
  let body = {}
  if (req.method === 'POST') {
    const parsed = parseBody(req)
    if (parsed.error) return json(res, 400, { error: parsed.error })
    body = parsed.body || {}
  } else {
    const url = new URL(req.url || '/', 'http://localhost')
    body = {
      lat: url.searchParams.get('lat'),
      lng: url.searchParams.get('lng'),
      label: url.searchParams.get('label') || '',
      tier: url.searchParams.get('tier') || 'standard',
    }
  }
  let offer
  try {
    offer = await (deps.loadNearTermOffer || loadNearTermOffer)(sb, {
      pickup: pickupFrom(body),
      tier: body.tier || 'standard',
      now,
      riderIsE2E: isE2ETestUser(user),
    })
  } catch (error) {
    return json(res, error.status || 400, {
      error: error.message || 'Could not calculate pickup times.',
      code: error.code || 'ride_option_unavailable',
    })
  }
  return json(res, 200, {
    waitMinutes: offer.waitMinutes,
    waitLabel: offer.waitLabel,
    availableDrivers: offer.availableDrivers,
    nearest: offer.nearest || null,
    slots: offer.slots,
    reason: offer.reason,
    emptyMessage: offer.emptyMessage,
    window: offer.window,
    tier: offer.tier,
    basis: offer.basis,
    demoDriversExcluded: true,
  })
}
