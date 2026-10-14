#!/usr/bin/env node
/**
 * Creates the Clemson Rides student plan Stripe Products and Prices, INACTIVE.
 * Run ONLY after the Clemson Rides live key is in place. Never run it against
 * ScreenshotSticky.
 *
 *   STRIPE_SECRET_KEY=... STUDENT_PLANS_STRIPE_ACCOUNT_ID=acct_... \
 *     node scripts/create-student-plan-prices.mjs            # dry run (default)
 *   ... node scripts/create-student-plan-prices.mjs --apply  # create, inactive
 *
 * Safety: refuses unless the key's account id equals
 * STUDENT_PLANS_STRIPE_ACCOUNT_ID and the account name says Clemson Rides.
 * Never prints the key. Prints the Price IDs to put in env:
 *   STRIPE_PRICE_WEEKEND_CARPOOL_MONTHLY, STRIPE_PRICE_WEEKEND_CARPOOL_SEMESTER,
 *   STRIPE_PRODUCT_PERSONALIZED_PLAN
 * Activate them in the Stripe dashboard only when John says go.
 */
import Stripe from 'stripe'

export const PLAN_CATALOG = [
  {
    key: 'weekend_carpool',
    product: { name: 'Clemson Rides Weekend Carpool Plan', metadata: { app: 'clemson_rides', plan_id: 'weekend_carpool' } },
    prices: [
      { env: 'STRIPE_PRICE_WEEKEND_CARPOOL_MONTHLY', unit_amount: 8900, recurring: { interval: 'month' }, nickname: 'Weekend Carpool monthly (school months)' },
      { env: 'STRIPE_PRICE_WEEKEND_CARPOOL_SEMESTER', unit_amount: 34900, recurring: { interval: 'month', interval_count: 4 }, nickname: 'Weekend Carpool semester' },
    ],
  },
  {
    key: 'personalized',
    product: { name: 'Clemson Rides Student Plan (personalized)', metadata: { app: 'clemson_rides', plan_id: 'personalized' } },
    env: 'STRIPE_PRODUCT_PERSONALIZED_PLAN',
    prices: [],
  },
]

export function accountLooksLikeClemsonRides(acct, expectedId) {
  if (!acct?.id || !expectedId || acct.id !== expectedId) return false
  const name = [acct.business_profile?.name, acct.settings?.dashboard?.display_name, acct.email].filter(Boolean).join(' ').toLowerCase()
  if (/screenshot\s*sticky/.test(name)) return false
  return /clemson\s*rides/.test(name)
}

async function main() {
  const apply = process.argv.includes('--apply')
  const key = String(process.env.STRIPE_SECRET_KEY || '').trim()
  const expected = String(process.env.STUDENT_PLANS_STRIPE_ACCOUNT_ID || '').trim()
  if (!key || !expected) {
    console.error('Set STRIPE_SECRET_KEY (Clemson Rides) and STUDENT_PLANS_STRIPE_ACCOUNT_ID.')
    process.exit(2)
  }
  const stripe = new Stripe(key)
  const acct = await stripe.accounts.retrieve()
  if (!accountLooksLikeClemsonRides(acct, expected)) {
    console.error(`Refusing: key belongs to ${acct?.id || 'unknown'}, not the Clemson Rides account ${expected}.`)
    process.exit(3)
  }
  console.log(`Account ${acct.id} (${key.startsWith('sk_live') || key.startsWith('rk_live') ? 'live' : 'test'} mode). ${apply ? 'Creating INACTIVE objects.' : 'Dry run; pass --apply to create.'}`)
  const out = {}
  for (const plan of PLAN_CATALOG) {
    if (!apply) {
      console.log(`[dry-run] product "${plan.product.name}" (inactive) with ${plan.prices.length} price(s)`)
      continue
    }
    const product = await stripe.products.create({ ...plan.product, active: false }, { idempotencyKey: `clemson-student-plan-product-${plan.key}` })
    if (plan.env) out[plan.env] = product.id
    for (const p of plan.prices) {
      const price = await stripe.prices.create({
        product: product.id, currency: 'usd', unit_amount: p.unit_amount, recurring: p.recurring, nickname: p.nickname, active: false,
        metadata: { app: 'clemson_rides', plan_id: plan.key },
      }, { idempotencyKey: `clemson-student-plan-price-${plan.key}-${p.env}` })
      out[p.env] = price.id
    }
  }
  if (apply) {
    console.log('Add these to the Clemson Rides Vercel env (IDs are not secrets):')
    for (const [k, v] of Object.entries(out)) console.log(`${k}=${v}`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e?.message || 'failed')
    process.exit(1)
  })
}
