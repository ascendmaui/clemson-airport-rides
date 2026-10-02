/**
 * POST /api/buy-credits { packId }
 * Stripe Checkout for a credit pack. Lots are granted by the webhook (and
 * /api/credits-confirm on return). Purchase is a liability — 20% is not taken
 * until the credits pay for a ride.
 */
import {
  admin, cors, json, parseBody, userFromAuth, stripeClient, stripeOk, ensureStripeCustomer,
} from '../friendRideLib.js'
import { findCreditPack } from '../../src/lib/fareRates.js'
import { WEB_ORIGIN } from '../../shared/productLinks.js'

export default async function handler(req, res, deps = {}) {
  if (cors(req, res)) return
  if (req.method !== 'POST') {
    res.setHeader?.('Allow', 'POST, OPTIONS')
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 405, { error: 'Method not allowed' })
  }

  const stripeOkFn = deps.stripeOk || stripeOk
  if (!deps.stripe && !stripeOkFn()) {
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 503, { error: 'Payments unavailable', message: 'STRIPE_SECRET_KEY is not configured.' })
  }

  const sb = deps.sb !== undefined ? deps.sb : (deps.admin ? deps.admin() : admin())
  if (!sb) {
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  }

  const user = deps.user !== undefined ? deps.user : await (deps.userFromAuth || userFromAuth)(req, sb)
  if (!user) {
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 401, { error: 'Sign in required' })
  }

  const { body, error: pe } = parseBody(req)
  if (pe) {
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 400, { error: pe })
  }

  const packId = typeof body.packId === 'string' ? body.packId.trim() : body.packId
  const findPackFn = deps.findCreditPack || findCreditPack
  const pack = findPackFn(packId)
  if (!pack) {
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 400, { error: 'Unknown credit pack' })
  }

  const { data: profile } = await sb
    .from('profiles')
    .select('id, email, full_name, stripe_customer_id')
    .eq('id', user.id)
    .maybeSingle()

  try {
    const stripe = deps.stripe || (deps.stripeClient ? deps.stripeClient() : stripeClient())
    const ensureCustomerFn = deps.ensureStripeCustomer || ensureStripeCustomer
    let customerId = null
    if (profile) {
      try { customerId = await ensureCustomerFn(stripe, sb, profile) } catch { /* optional */ }
    }
    const origin = body.origin || process.env.VITE_APP_URL || WEB_ORIGIN
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId || undefined,
      customer_email: customerId ? undefined : (profile?.email || user.email || undefined),
      success_url: `${origin}/#/account?credits=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/#/account?credits=0`,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: pack.loadCents,
          product_data: {
            name: `Clemson RIDES credits — ${pack.label}`,
            description: 'Prepaid ride credits. The pack discount applies when these credits pay for a ride.',
          },
        },
      }],
      metadata: {
        kind: 'credit_purchase',
        pack_id: pack.id,
        profile_id: user.id,
        load_cents: String(pack.loadCents),
        discount_bps: String(pack.discountBps),
      },
    })
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 200, { id: session.id, url: session.url, pack })
  } catch (err) {
    console.error('[buy-credits]', err)
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 500, { error: err.message || 'Stripe error' })
  }
}
