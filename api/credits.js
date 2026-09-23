/**
 * GET  /api/credits — balance + prepaid tiers
 * POST /api/credits — { action: 'buy', tierId } charges the default card and adds credits
 */
import {
  admin, cors, json, parseBody, userFromAuth, stripeClient, stripeOk,
} from '../server/friendRideLib.js'
import { supabaseCreditStore } from '../server/credits.js'
import { collectPayment } from '../server/collectPayment.js'
import { PREPAID_TIERS, findPrepaidTier } from '../shared/prepaidTiers.js'

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  const credits = supabaseCreditStore(sb)

  if (req.method === 'GET') {
    const balance = await credits.getCredits(user.id)
    return json(res, 200, {
      balanceCents: balance.balanceCents,
      unavailable: balance.unavailable,
      tiers: PREPAID_TIERS,
    })
  }

  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })
  if (body.action !== 'buy') return json(res, 400, { error: 'action must be buy' })
  const tier = findPrepaidTier(body.tierId)
  if (!tier) return json(res, 400, { error: 'Unknown credit tier' })
  if (!stripeOk()) return json(res, 503, { error: 'Payments unavailable' })

  try {
    const paid = await collectPayment({
      sb,
      stripe: stripeClient(),
      riderId: user.id,
      amountCents: tier.priceCents,
      methods: ['card'],
      kind: 'credits_purchase',
      idempotencyKey: `credits:${user.id}:${tier.id}:${body.nonce || 'pack'}`,
      hold: false,
      metadata: { tierId: tier.id, creditCents: tier.creditCents },
    })
    if (!paid.ok) {
      return json(res, 402, { error: paid.message, failure: paid, status: 'payment_required' })
    }
    const credited = await credits.applyCredits(user.id, tier.creditCents, {
      kind: 'credits_purchase',
      idempotencyKey: `credits-grant:${user.id}:${tier.id}:${paid.paymentId || body.nonce || 'pack'}`,
    })
    if (!credited.ok) {
      console.error('[credits] purchased but grant failed', credited)
      return json(res, 500, {
        error: 'Card charged but credits could not be stored. Contact support with your payment id.',
        paymentId: paid.paymentId,
        code: credited.code || 'credits_unavailable',
      })
    }
    return json(res, 200, {
      ok: true,
      balanceCents: credited.balanceCents,
      grantedCents: tier.creditCents,
      paymentId: paid.paymentId,
      tier,
    })
  } catch (err) {
    console.error('[credits]', err)
    return json(res, 500, { error: err.message || 'Server error' })
  }
}
