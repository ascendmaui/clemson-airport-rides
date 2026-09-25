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

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  if (!stripeOk()) {
    return json(res, 503, { error: 'Payments unavailable', message: 'STRIPE_SECRET_KEY is not configured.' })
  }
  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })
  const pack = findCreditPack(body.packId)
  if (!pack) return json(res, 400, { error: 'Unknown credit pack' })

  const { data: profile } = await sb
    .from('profiles')
    .select('id, email, full_name, stripe_customer_id')
    .eq('id', user.id)
    .maybeSingle()

  try {
    const stripe = stripeClient()
    let customerId = null
    if (profile) {
      try { customerId = await ensureStripeCustomer(stripe, sb, profile) } catch { /* optional */ }
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
    return json(res, 200, { id: session.id, url: session.url, pack })
  } catch (err) {
    console.error('[buy-credits]', err)
    return json(res, 500, { error: err.message || 'Stripe error' })
  }
}
