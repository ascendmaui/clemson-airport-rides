/**
 * POST /api/trip-settle
 * { tripId, action: 'complete'|'cancel'|'charge', amountCents?, feeKind?, methods?, adminOverride? }
 *
 * Complete and paid-cancel do not change trip status until collectPayment succeeds.
 * $0 and fully discounted trips proceed. Admin override requires ADMIN_EMAILS or role=admin.
 * feeKind wait_fee / cancel_fee reads a precomputed metadata amount — it does not
 * recalculate wait minutes or cancel percentages.
 */
import {
  admin, cors, json, parseBody, userFromAuth, stripeClient, stripeOk,
} from '../server/friendRideLib.js'
import { isAdminUser, settleTrip } from '../server/tripSettle.js'

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })
  if (!body.tripId) return json(res, 400, { error: 'tripId required' })

  const tripRes = await sb
    .from('trips')
    .select('id, rider_id, driver_id, status, fare_cents, metadata')
    .eq('id', body.tripId)
    .maybeSingle()
  if (tripRes.error || !tripRes.data) return json(res, 404, { error: 'Trip not found' })
  const trip = tripRes.data

  const profileRes = await sb.from('profiles').select('id, email, role').eq('id', user.id).maybeSingle()
  const profile = profileRes.error ? null : profileRes.data
  const adminUser = isAdminUser(user, profile)
  if (trip.rider_id !== user.id && trip.driver_id !== user.id && !adminUser) {
    return json(res, 403, { error: 'Not allowed on this trip' })
  }

  if (['completed', 'canceled'].includes(trip.status) && body.action !== 'charge') {
    return json(res, 409, { error: `Trip already ${trip.status}`, status: trip.status })
  }

  const payRes = await sb.from('payments').select('id, status, kind, amount_cents, metadata').eq('trip_id', trip.id)
  const payments = payRes.error ? [] : (payRes.data || [])

  const duePreview = body.amountCents != null ? Number(body.amountCents) : null
  if ((duePreview == null || duePreview > 0) && body.action === 'charge' && !stripeOk()) {
    return json(res, 503, { error: 'Payments unavailable' })
  }

  try {
    const settled = await settleTrip({
      sb,
      stripe: stripeClient(),
      trip,
      payments,
      action: body.action,
      explicitAmountCents: body.amountCents,
      feeKind: body.feeKind || null,
      requireFee: Boolean(body.requireFee),
      adminOverride: Boolean(body.adminOverride),
      methods: body.methods,
      paymentMethodId: body.paymentMethodId || null,
      actor: user,
    })
    return json(res, settled.http, settled.body)
  } catch (err) {
    console.error('[trip-settle]', err)
    return json(res, 500, { error: err.message || 'Server error' })
  }
}
