/**
 * POST /api/stripe-save-payment-method
 * After SetupIntent succeeds, persist profiles.stripe_default_pm_id.
 */
import {
  admin, cors, json, parseBody, userFromAuth, stripeClient, stripeOk,
} from '../server/friendRideLib.js'

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  if (!stripeOk()) return json(res, 503, { error: 'Payments unavailable' })

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })

  const paymentMethodId = body.paymentMethodId || body.payment_method
  const setupIntentId = body.setupIntentId || body.setup_intent
  if (!paymentMethodId && !setupIntentId) {
    return json(res, 400, { error: 'paymentMethodId or setupIntentId required' })
  }

  const stripe = stripeClient()

  try {
    let pmId = paymentMethodId
    if (!pmId && setupIntentId) {
      const si = await stripe.setupIntents.retrieve(setupIntentId)
      if (si.status !== 'succeeded') {
        return json(res, 400, { error: `SetupIntent status ${si.status}` })
      }
      pmId = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id
    }
    if (!pmId) return json(res, 400, { error: 'No payment method on SetupIntent' })

    const { data: profile } = await sb
      .from('profiles')
      .select('id, stripe_customer_id')
      .eq('id', user.id)
      .single()

    if (profile?.stripe_customer_id) {
      await stripe.customers.update(profile.stripe_customer_id, {
        invoice_settings: { default_payment_method: pmId },
      })
    }

    const { error } = await sb
      .from('profiles')
      .update({
        stripe_default_pm_id: pmId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id)
    if (error) return json(res, 500, { error: error.message })

    return json(res, 200, { ok: true, paymentMethodId: pmId })
  } catch (e) {
    return json(res, 500, { error: e.message || 'Server error' })
  }
}
