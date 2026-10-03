/**
 * Saved-card handlers served by /api/stripe-payment-methods.
 * Response bodies match the previous standalone routes.
 */
import {
  admin,
  cors,
  json,
  parseBody,
  userFromAuth,
  stripeClient,
  stripeOk,
  ensureStripeCustomer,
} from './friendRideLib.js'
import {
  ADD_ANOTHER_PAYMENT_METHOD_ID,
  buildSetupCheckoutParams,
  buildSetupIntentParams,
  narrowSetupPaymentMethodTypes,
  setupPaymentMethodTypes,
} from '../shared/ridePaymentMethods.js'

async function createWithAllowedTypes(types, create) {
  let attempt = types
  let lastError = null
  while (attempt) {
    try {
      const result = await create(attempt)
      return { result, types: attempt }
    } catch (err) {
      lastError = err
      const next = narrowSetupPaymentMethodTypes(attempt, err?.message || err?.raw?.message)
      if (!next) break
      attempt = next
    }
  }
  throw lastError
}

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

export async function handleStripeSetupIntent(req, res) {
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

    const methodId = typeof body?.paymentMethod === 'string' && body.paymentMethod
      ? body.paymentMethod
      : ADD_ANOTHER_PAYMENT_METHOD_ID
    const requestedTypes = setupPaymentMethodTypes(methodId)
    const wantsCheckout = body?.checkout === true

    const created = await createWithAllowedTypes(requestedTypes, (types) => {
      if (wantsCheckout) {
        return stripe.checkout.sessions.create(buildSetupCheckoutParams({
          customerId,
          userId: user.id,
          paymentMethod: methodId,
          types,
          returnUrl: body?.returnUrl,
        }))
      }
      return stripe.setupIntents.create(buildSetupIntentParams({
        customerId,
        userId: user.id,
        paymentMethod: methodId,
        types,
      }))
    })

    if (wantsCheckout) {
      const session = created.result
      return json(res, 200, {
        url: session.url,
        sessionId: session.id,
        customerId,
        paymentMethodTypes: created.types,
        hasDefaultPm: Boolean(profile.stripe_default_pm_id),
        defaultPmId: profile.stripe_default_pm_id || null,
        billingActivatedAt: profile.billing_activated_at || null,
        schemaNote: softFail || undefined,
        note: 'Apple Pay on the website needs the domain registered in Stripe Dashboard → Payment method domains. This setup checkout does not charge the card.',
      })
    }

    const setupIntent = created.result

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

export async function handleStripeSavePaymentMethod(req, res) {
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
  let setupIntentId = body.setupIntentId || body.setup_intent
  const checkoutSessionId = body.checkoutSessionId || body.checkout_session_id
  let sessionCustomer = null

  const stripe = stripeClient()

  try {
    if (!paymentMethodId && !setupIntentId && checkoutSessionId) {
      const session = await stripe.checkout.sessions.retrieve(String(checkoutSessionId))
      if (session.mode !== 'setup' || session.status !== 'complete') {
        return json(res, 400, { error: 'Setup checkout is not complete' })
      }
      if (session.metadata?.profile_id && session.metadata.profile_id !== user.id) {
        return json(res, 403, { error: 'Setup session does not belong to this account' })
      }
      sessionCustomer = typeof session.customer === 'string' ? session.customer : session.customer?.id || null
      const siRef = session.setup_intent
      setupIntentId = typeof siRef === 'string' ? siRef : siRef?.id
    }
    if (!paymentMethodId && !setupIntentId) {
      return json(res, 400, { error: 'paymentMethodId or setupIntentId required' })
    }

    let pmId = paymentMethodId
    if (!pmId && setupIntentId) {
      const si = await stripe.setupIntents.retrieve(setupIntentId)
      if (si.status !== 'succeeded') {
        return json(res, 400, { error: `SetupIntent status ${si.status}` })
      }
      pmId = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id
    }
    if (!pmId) return json(res, 400, { error: 'No payment method on SetupIntent' })

    const pm = await stripe.paymentMethods.retrieve(pmId)
    const brand = pm.card?.brand || pm.type || null
    const last4 = pm.card?.last4 || null

    const { data: profile } = await sb
      .from('profiles')
      .select('id, stripe_customer_id')
      .eq('id', user.id)
      .single()

    if (sessionCustomer && profile?.stripe_customer_id && sessionCustomer !== profile.stripe_customer_id) {
      return json(res, 403, { error: 'Setup session does not belong to this account' })
    }

    if (profile?.stripe_customer_id) {
      await stripe.customers.update(profile.stripe_customer_id, {
        invoice_settings: { default_payment_method: pmId },
      })
    }

    const now = new Date().toISOString()
    const basePatch = {
      stripe_default_pm_id: pmId,
      updated_at: now,
    }

    let { error } = await sb
      .from('profiles')
      .update({
        ...basePatch,
        billing_activated_at: now,
        stripe_card_brand: brand,
        stripe_card_last4: last4,
      })
      .eq('id', user.id)

    if (error && /column|schema cache|billing_activated|stripe_card_/i.test(error.message || '')) {
      const retry = await sb
        .from('profiles')
        .update(basePatch)
        .eq('id', user.id)
      error = retry.error
      if (!error) {
        await sb
          .from('profiles')
          .update({ billing_activated_at: now, updated_at: now })
          .eq('id', user.id)
      }
    }
    if (error) return json(res, 500, { error: error.message })

    return json(res, 200, {
      ok: true,
      paymentMethodId: pmId,
      brand,
      last4,
      cardBrand: brand,
      cardLast4: last4,
      billingActivatedAt: now,
    })
  } catch (e) {
    return json(res, 500, { error: e.message || 'Server error' })
  }
}
