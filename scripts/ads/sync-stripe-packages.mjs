#!/usr/bin/env node
/**
 * Create Stripe Products and Prices for approved ad packages (public.ad_packages).
 * Run ONLY after John approves the real tiers.
 *
 *   node scripts/ads/sync-stripe-packages.mjs            # dry run: prints the plan, touches nothing
 *   ADS_BILLING_ENABLED=true node scripts/ads/sync-stripe-packages.mjs --apply
 *
 * Needs STRIPE_SECRET_KEY and SUPABASE_SERVICE_ROLE_KEY (+ SUPABASE_URL) in the environment.
 * Skips placeholder or inactive packages and packages without a price. Idempotent: a package that
 * already has stripe_price_id for the same amount is left alone; a changed amount gets a new Price.
 */
import { pathToFileURL } from 'node:url'

export function planPackageSync(packages = []) {
  const plan = []
  for (const p of packages) {
    if (p.placeholder) { plan.push({ id: p.id, action: 'skip', reason: 'placeholder' }); continue }
    if (!p.active) { plan.push({ id: p.id, action: 'skip', reason: 'inactive' }); continue }
    if (!(Number(p.price_cents) > 0)) { plan.push({ id: p.id, action: 'skip', reason: 'no_price' }); continue }
    plan.push({ id: p.id, action: p.stripe_product_id ? 'ensure_price' : 'create_product_and_price', price_cents: p.price_cents })
  }
  return plan
}

export async function applyPackageSync({ stripe, sb, packages }) {
  const out = []
  for (const step of planPackageSync(packages)) {
    if (step.action === 'skip') { out.push(step); continue }
    const p = packages.find((x) => x.id === step.id)
    let productId = p.stripe_product_id
    if (!productId) {
      const product = await stripe.products.create({
        name: `Clemson Rides tablet ads: ${p.name}`,
        description: p.description || undefined,
        metadata: { kind: 'ad_package', package_id: p.id },
      }, { idempotencyKey: `ad-package-product-${p.id}` })
      productId = product.id
    }
    let priceId = p.stripe_price_id
    if (priceId) {
      const existing = await stripe.prices.retrieve(priceId)
      if (existing.unit_amount !== p.price_cents || existing.currency !== (p.currency || 'usd')) priceId = null
    }
    if (!priceId) {
      const price = await stripe.prices.create({
        product: productId,
        unit_amount: p.price_cents,
        currency: p.currency || 'usd',
        metadata: { kind: 'ad_package', package_id: p.id },
      }, { idempotencyKey: `ad-package-price-${p.id}-${p.price_cents}` })
      priceId = price.id
    }
    await sb.from('ad_packages').update({ stripe_product_id: productId, stripe_price_id: priceId, updated_at: new Date().toISOString() }).eq('id', p.id)
    out.push({ ...step, stripe_product_id: productId, stripe_price_id: priceId })
  }
  return out
}

async function main() {
  const apply = process.argv.includes('--apply')
  const { createClient } = await import('@supabase/supabase-js')
  const url = process.env.SUPABASE_URL || 'https://awktabuhijrshmsmagpq.supabase.co'
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('Set SUPABASE_SERVICE_ROLE_KEY')
  const sb = createClient(url, key, { auth: { persistSession: false } })
  const { data: packages, error } = await sb.from('ad_packages').select('*').order('sort')
  if (error) throw new Error(error.message)
  const plan = planPackageSync(packages)
  console.log(JSON.stringify({ apply, plan }, null, 2))
  if (!apply) return console.log('Dry run. Re-run with ADS_BILLING_ENABLED=true and --apply once the tiers are approved.')
  if (String(process.env.ADS_BILLING_ENABLED).toLowerCase() !== 'true') throw new Error('ADS_BILLING_ENABLED must be true to create Stripe products')
  const { default: Stripe } = await import('stripe')
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  console.log(JSON.stringify(await applyPackageSync({ stripe, sb, packages }), null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err.message || err); process.exit(1) })
}
