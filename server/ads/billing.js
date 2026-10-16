/**
 * Ad campaign billing on the Clemson Rides Stripe account.
 * OFF unless ADS_BILLING_ENABLED=true. Nothing here runs from tests against Stripe:
 * every function takes an injected `stripe` client.
 *
 * Flow: admin "Send payment link" -> startCampaignPayment()
 *   -> customer (reused via ad_partners.stripe_customer_id)
 *   -> mode 'invoice': invoice item + invoice (send_invoice, 14 days) finalized -> hosted_invoice_url
 *      mode 'checkout': Checkout Session (payment) -> session.url
 *   -> ad_campaigns.status = pending_payment, payment_url saved
 * Stripe webhook (invoice.paid | checkout.session.completed, metadata.kind = ad_campaign)
 *   -> handleAdsStripeEvent() -> campaign active, paid_at, starts_at/ends_at from the package.
 */
const DAY = 86_400_000
export const ADS_KIND = 'ad_campaign'

export function adsBillingEnabled(env = process.env) {
  return String(env?.ADS_BILLING_ENABLED || '').trim().toLowerCase() === 'true'
}

function fail(status, error) {
  const e = new Error(error)
  e.status = status
  return e
}

export function campaignMetadata(campaign) {
  return { kind: ADS_KIND, campaign_id: campaign.id, partner_id: campaign.partner_id, package_id: campaign.package_id || '' }
}

/** Amount to bill: the package price unless the campaign carries a quoted price (founding partner). */
export function campaignAmountCents(campaign, pkg) {
  const quoted = Number(campaign?.price_cents)
  if (Number.isFinite(quoted) && quoted > 0) return Math.round(quoted)
  const price = Number(pkg?.price_cents)
  return Number.isFinite(price) && price > 0 ? Math.round(price) : 0
}

export async function ensureCustomer(stripe, sb, partner) {
  if (partner.stripe_customer_id) return partner.stripe_customer_id
  const customer = await stripe.customers.create({
    name: partner.business_name,
    email: partner.email,
    phone: partner.phone || undefined,
    metadata: { kind: 'ad_partner', partner_id: partner.id },
  }, { idempotencyKey: `ad-partner-customer-${partner.id}` })
  await sb.from('ad_partners').update({ stripe_customer_id: customer.id }).eq('id', partner.id)
  return customer.id
}

export async function startCampaignPayment({ stripe, sb, campaignId, mode = 'invoice', origin = 'https://clemsonrides.com', env = process.env }) {
  if (!adsBillingEnabled(env)) return { skipped: true, reason: 'ADS_BILLING_ENABLED is off' }
  if (!stripe) throw fail(503, 'Stripe is not configured')
  const { data: campaign, error } = await sb.from('ad_campaigns').select('*, ad_partners(*), ad_packages(*)').eq('id', campaignId).maybeSingle()
  if (error) throw fail(500, error.message)
  if (!campaign) throw fail(404, 'Campaign not found')
  const pkg = campaign.ad_packages
  if (pkg?.placeholder) throw fail(409, 'Placeholder packages cannot be billed. Approve real tiers first.')
  const amount = campaignAmountCents(campaign, pkg)
  if (!amount) throw fail(409, 'Set a price on the campaign or its package before billing.')
  const partner = campaign.ad_partners
  const customer = await ensureCustomer(stripe, sb, partner)
  const metadata = campaignMetadata(campaign)
  const description = `Clemson Rides in-car tablet ads: ${pkg?.name || 'Founding partner'}`
  let patch
  if (mode === 'checkout') {
    const line = pkg?.stripe_price_id && !campaign.price_cents
      ? { price: pkg.stripe_price_id, quantity: 1 }
      : { price_data: { currency: pkg?.currency || 'usd', unit_amount: amount, product_data: { name: description } }, quantity: 1 }
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer,
      line_items: [line],
      metadata,
      payment_intent_data: { metadata },
      success_url: `${origin}/advertise/my?paid=1`,
      cancel_url: `${origin}/advertise/my`,
    }, { idempotencyKey: `ad-checkout-${campaign.id}-${amount}` })
    patch = { stripe_checkout_session_id: session.id, payment_url: session.url }
  } else {
    const invoice = await stripe.invoices.create({
      customer,
      collection_method: 'send_invoice',
      days_until_due: 14,
      auto_advance: false,
      metadata,
      description,
    }, { idempotencyKey: `ad-invoice-${campaign.id}-${amount}` })
    await stripe.invoiceItems.create({ customer, invoice: invoice.id, amount, currency: pkg?.currency || 'usd', description, metadata },
      { idempotencyKey: `ad-invoice-item-${campaign.id}-${amount}` })
    const finalized = await stripe.invoices.finalizeInvoice(invoice.id, { auto_advance: false })
    patch = { stripe_invoice_id: finalized.id, payment_url: finalized.hosted_invoice_url }
  }
  await sb.from('ad_campaigns').update({ ...patch, status: 'pending_payment', updated_at: new Date().toISOString() }).eq('id', campaign.id)
  return { ok: true, mode, ...patch }
}

export function isAdsStripeEvent(event) {
  const t = event?.type
  if (t !== 'invoice.paid' && t !== 'checkout.session.completed' && t !== 'checkout.session.async_payment_succeeded') return false
  return event?.data?.object?.metadata?.kind === ADS_KIND
}

/** Marks the campaign active once Stripe says it is paid. Idempotent. */
export async function handleAdsStripeEvent(sb, event, { now = new Date() } = {}) {
  if (!sb) return { ok: false, skipped: true, reason: 'no_service_role' }
  const obj = event.data.object
  if (event.type.startsWith('checkout.session') && obj.payment_status && obj.payment_status !== 'paid') {
    return { ok: true, skipped: true, reason: 'not_paid' }
  }
  const id = obj.metadata?.campaign_id
  if (!id) return { ok: true, skipped: true, reason: 'no_campaign_id' }
  const { data: c, error } = await sb.from('ad_campaigns').select('*, ad_packages(*)').eq('id', id).maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!c) return { ok: true, skipped: true, reason: 'campaign_missing' }
  if (c.paid_at && c.status === 'active') return { ok: true, already: true }
  const start = c.starts_at && Date.parse(c.starts_at) > now.getTime() ? c.starts_at : now.toISOString()
  const days = c.ad_packages?.duration_days || 30
  const patch = {
    status: 'active',
    paid_at: now.toISOString(),
    starts_at: start,
    ends_at: c.ends_at || new Date(Date.parse(start) + days * DAY).toISOString(),
    rides_purchased: c.rides_purchased ?? c.ad_packages?.rides_included ?? null,
    updated_at: now.toISOString(),
  }
  if (obj.object === 'invoice') patch.stripe_invoice_id = obj.id
  else patch.stripe_checkout_session_id = obj.id
  const { error: upErr } = await sb.from('ad_campaigns').update(patch).eq('id', id)
  if (upErr) return { ok: false, error: upErr.message }
  await sb.from('ad_partners').update({ status: 'active', updated_at: now.toISOString() }).eq('id', c.partner_id).eq('status', 'pending')
  return { ok: true, activated: id }
}
