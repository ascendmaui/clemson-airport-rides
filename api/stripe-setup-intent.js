/**
 * POST /api/stripe-setup-intent
 * Auth required. Creates/ensures Stripe Customer + SetupIntent (off_session usage).
 * Client confirms with Payment Element / Apple Pay; then call /api/stripe-save-payment-method.
 */
import {
  admin, cors, json, parseBody, userFromAuth, stripeClient, stripeOk, ensureStripeCustomer,
} from '../server/friendRideLib.js'

async function loadProfile(sb, userId) {
  const rich = await sb
    .from('profiles')
    .select('id, email, full_name, stripe_customer_id, stripe_default_pm_id, billing_activated_at, stripe_card_brand, stripe_card_last4')
    .eq('id', userId)
    .maybeSingle()
  if (!rich.error) return { profile: rich.data, softFail: null }
  if (/column|schema cache|billing_activated|stripe_card_/i.test(rich.error.message || '')) {
    const basic = await sb
      .from('profiles')
      .select('id, email, full_name, stripe_customer_id, stripe_default_pm_id')
      .eq('id', userId)
      .maybeSingle()
    if (basic.error) throw new Error(basic.error.message)
    return { profile: basic.data, softFail: rich.error.message }
  }
  throw new Error(rich.error.message)
}

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  if (!stripeOk()) {
    return json(res, 503, {
      error: 'Payments unavailable',
      message: 'STRIPE_SECRET_KEY is not configured.',
    })
  }

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  const stripe = stripeClient()
  const { body } = parseBody(req)

  try {
    let { profile, softFail } = await loadProfile(sb, user.id)

    if (!profile) {
      const { data: created, error } = await sb
        .from('profiles')
        .upsert({
          id: user.id,
          email: user.email,
          full_name: user.user_metadata?.full_name || null,
          role: 'rider',
        })
        .select('id, email, full_name, stripe_customer_id, stripe_default_pm_id')
        .single()
      if (error) return json(res, 500, { error: error.message })
      profile = created
    }

    const customerId = await ensureStripeCustomer(stripe, sb, {
      ...profile,
      email: profile.email || user.email,
    })

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      usage: 'off_session',
      automatic_payment_methods: { enabled: true },
      metadata: {
        profile_id: user.id,
        kind: 'save_card',
      },
    })

    let cardBrand = profile.stripe_card_brand || null
    let cardLast4 = profile.stripe_card_last4 || null
    if (profile.stripe_default_pm_id && (!cardBrand || !cardLast4)) {
      try {
        const pm = await stripe.paymentMethods.retrieve(profile.stripe_default_pm_id)
        cardBrand = pm.card?.brand || pm.type || cardBrand
        cardLast4 = pm.card?.last4 || cardLast4
      } catch {
        /* ignore retrieve errors */
      }
    }

    return json(res, 200, {
      clientSecret: setupIntent.client_secret,
      setupIntentId: setupIntent.id,
      customerId,
      hasDefaultPm: Boolean(profile.stripe_default_pm_id),
      defaultPmId: profile.stripe_default_pm_id || null,
      cardBrand,
      cardLast4,
      billingActivatedAt: profile.billing_activated_at || null,
      schemaNote: softFail || undefined,
      publishableKeyHint: 'Use VITE_STRIPE_PUBLISHABLE_KEY with Payment Element',
      note: body?.note || 'Apple Pay: register domain in Stripe Dashboard.',
    })
  } catch (e) {
    console.error('[stripe-setup-intent]', e)
    return json(res, 500, { error: e.message || 'Server error' })
  }
}
