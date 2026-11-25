/**
 * Student plans service: status, clemson.edu OTP, registrar check, subscribe
 * (Stripe recurring + 7-day trial), pause/resume, cancel, webhook sync,
 * referral credits, and unsubscribe. Everything is gated by
 * studentPlansEnabled(env, user) at the endpoint.
 *
 * Stripe safety: subscriptions are created only when the configured Price IDs
 * exist AND the Stripe key belongs to STUDENT_PLANS_STRIPE_ACCOUNT_ID (the
 * Clemson Rides account). Any other account (e.g. ScreenshotSticky) is refused.
 */
import { createHash, randomInt } from 'node:crypto'
import {
  PLAN_IDS, TRIAL_DAYS, WEEKEND_CARPOOL_PLAN, activeClockDays, enrollmentCurrent, isClemsonStudentEmail,
  pauseWindowsFromEnv, priceIdsFromEnv, termCode, validatePause, weekendCarpoolCoverage, windowFromEnv,
} from '../shared/studentPlans.js'
import { registrarProvider } from './registrarCheck.js'
import { supabaseCreditStore } from './credits.js'

export const OTP_TTL_MINUTES = 10
export const OTP_MAX_ATTEMPTS = 5
export const REFERRAL_CREDIT_CENTS_DEFAULT = 1000

function err(status, code, message) {
  const e = new Error(message || code)
  e.status = status
  e.code = code
  return e
}

function one(result) {
  if (result?.error) throw err(500, 'db_error', result.error.message)
  return result?.data ?? null
}

export function hashOtp(riderId, code) {
  return createHash('sha256').update(`${riderId}:${String(code).trim()}`).digest('hex')
}

function flagOn(v) {
  const s = String(v ?? '').trim().toLowerCase()
  return s === '1' || s === 'true'
}

// ---------- status ----------

export async function loadStudentPlanStatus(sb, user, { now = new Date(), env = process.env } = {}) {
  const term = termCode(now)
  const [sub, enrollment, quote, pauses, trips] = await Promise.all([
    sb.from('student_plan_subscriptions').select('*').eq('rider_id', user.id).maybeSingle().then(one),
    sb.from('student_enrollments').select('*').eq('rider_id', user.id).eq('term_code', term).maybeSingle().then(one),
    sb.from('plan_quotes').select('id, quoted_plan, recommendation, monthly_cents, semester_cents, retail_monthly_cents, savings_cents, summary, expires_at, pattern').eq('rider_id', user.id).maybeSingle().then(one),
    sb.from('subscription_pauses').select('*').eq('rider_id', user.id).order('start_date', { ascending: true }).then(one),
    sb.from('trips').select('id, tier, fare_cents, surge_multiplier, passengers, completed_at, pickup_at, metadata, status, payment_status').eq('rider_id', user.id).eq('status', 'completed').order('completed_at', { ascending: false }).limit(10).then(one),
  ])
  const window = windowFromEnv(env)
  const planActive = Boolean(sub && ['trialing', 'active'].includes(sub.status) && sub.plan_id === PLAN_IDS.WEEKEND_CARPOOL)
  const recentFares = (trips || []).map((t) => {
    const riders = Number(t.metadata?.carpool_riders || t.metadata?.riders || t.passengers || 1)
    const carpool = String(t.tier || '').toLowerCase().includes('carpool') || Boolean(t.metadata?.carpool_group_id)
    const c = weekendCarpoolCoverage({ fareCents: t.fare_cents, surgeMultiplier: t.surge_multiplier, riders, carpool, at: t.completed_at || t.pickup_at, window, active: planActive })
    return { tripId: t.id, at: t.completed_at, fareCents: c.fareCents, covered: c.covered, label: c.label, riderPaysCents: c.riderPaysCents }
  })
  const prices = priceIdsFromEnv(env)
  return {
    enabled: true,
    plans: {
      weekendCarpool: { ...WEEKEND_CARPOOL_PLAN, window },
    },
    quote: quote || null,
    subscription: sub ? {
      planId: sub.plan_id,
      status: sub.status,
      interval: sub.billing_interval,
      priceCents: sub.price_cents,
      trialEndsAt: sub.trial_ends_at,
      trialUsed: Boolean(sub.trial_used_at),
      currentPeriodEnd: sub.current_period_end,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      clockDays: activeClockDays(sub.window_start, pauses || [], now),
    } : null,
    verification: {
      email: user.email || null,
      clemsonEmail: isClemsonStudentEmail(user.email),
      term,
      emailVerified: Boolean(enrollment?.email_verified_at),
      registrarStatus: enrollment?.status || null,
      current: enrollmentCurrent(enrollment, now),
    },
    pauses: pauses || [],
    pauseWindows: pauseWindowsFromEnv(env),
    recentFares,
    billingReady: Boolean(prices.weekend_carpool.month && prices.weekend_carpool.semester && env.STUDENT_PLANS_STRIPE_ACCOUNT_ID),
  }
}

// ---------- OTP ----------

export async function requestStudentOtp(sb, user, { now = new Date(), env = process.env, send } = {}) {
  const email = String(user.email || '').trim().toLowerCase()
  if (!isClemsonStudentEmail(email)) throw err(400, 'not_clemson_email', 'Use your clemson.edu email to verify.')
  const code = String(randomInt(0, 1000000)).padStart(6, '0')
  one(await sb.from('student_email_otps').insert({
    rider_id: user.id,
    email,
    code_hash: hashOtp(user.id, code),
    expires_at: new Date(now.getTime() + OTP_TTL_MINUTES * 60000).toISOString(),
  }))
  // Delivery is OFF until STUDENT_PLAN_OTP_SEND=1. No email leaves the system.
  if (flagOn(env.STUDENT_PLAN_OTP_SEND) && typeof send === 'function') {
    await send({ to: email, subject: 'Your Clemson Rides student code', text: `Your Clemson Rides code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes.` })
    return { ok: true, delivered: true, email }
  }
  return { ok: true, delivered: false, reason: 'otp_delivery_disabled', email }
}

export async function verifyStudentOtp(sb, user, code, { now = new Date(), env = process.env } = {}) {
  const row = one(await sb.from('student_email_otps').select('*').eq('rider_id', user.id).is('consumed_at', null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle())
  if (!row) throw err(400, 'no_code', 'Request a new code.')
  if (Date.parse(row.expires_at) < now.getTime()) throw err(400, 'code_expired', 'That code expired. Request a new one.')
  if (row.attempts >= OTP_MAX_ATTEMPTS) throw err(429, 'too_many_attempts', 'Too many tries. Request a new code.')
  if (row.code_hash !== hashOtp(user.id, code)) {
    one(await sb.from('student_email_otps').update({ attempts: row.attempts + 1 }).eq('id', row.id))
    throw err(400, 'wrong_code', 'That code did not match.')
  }
  one(await sb.from('student_email_otps').update({ consumed_at: now.toISOString() }).eq('id', row.id))
  const term = termCode(now)
  const provider = registrarProvider(env)
  const check = await provider.check({ riderId: user.id, email: row.email, term })
  const enrollment = {
    rider_id: user.id,
    email: row.email,
    email_verified_at: now.toISOString(),
    method: check.method || provider.name,
    vendor_ref: check.vendorRef || null,
    status: check.status || 'pending',
    term_code: term,
    verified_at: check.status === 'verified' ? now.toISOString() : null,
    raw_result: check.raw || null,
    updated_at: now.toISOString(),
  }
  one(await sb.from('student_enrollments').upsert(enrollment, { onConflict: 'rider_id,term_code' }))
  return { ok: true, emailVerified: true, registrarStatus: enrollment.status, term }
}

/** Manual registrar approval by an admin (no vendor connected). */
export async function adminReviewEnrollment(sb, admin, { riderId, approve, term }, { now = new Date() } = {}) {
  const prof = one(await sb.from('profiles').select('is_admin').eq('id', admin.id).maybeSingle())
  if (!prof?.is_admin) throw err(403, 'admin_only', 'Admins only.')
  if (!riderId) throw err(400, 'rider_required')
  const t = term || termCode(now)
  const patch = approve
    ? { status: 'verified', verified_at: now.toISOString(), method: 'manual', reviewed_by: admin.id, updated_at: now.toISOString() }
    : { status: 'failed', verified_at: null, reviewed_by: admin.id, updated_at: now.toISOString() }
  one(await sb.from('student_enrollments').update(patch).eq('rider_id', riderId).eq('term_code', t))
  return { ok: true, riderId, term: t, status: patch.status }
}

export async function listPendingEnrollments(sb, admin, { now = new Date() } = {}) {
  const prof = one(await sb.from('profiles').select('is_admin').eq('id', admin.id).maybeSingle())
  if (!prof?.is_admin) throw err(403, 'admin_only', 'Admins only.')
  return one(await sb.from('student_enrollments').select('rider_id, email, term_code, status, email_verified_at, created_at')
    .eq('status', 'pending').eq('term_code', termCode(now)).order('created_at', { ascending: true }).limit(200)) || []
}

// ---------- Stripe ----------

export async function assertClemsonStripeAccount(stripe, env = process.env) {
  const want = String(env.STUDENT_PLANS_STRIPE_ACCOUNT_ID || '').trim()
  if (!want) throw err(503, 'stripe_account_not_configured', 'Student plan billing is not set up yet.')
  const acct = await stripe.accounts.retrieve()
  if (!acct?.id || acct.id !== want) throw err(503, 'stripe_account_mismatch', 'Student plan billing is not set up yet.')
  return acct.id
}

export function subscriptionItems({ planId, interval, priceCents, env = process.env }) {
  const prices = priceIdsFromEnv(env)
  if (planId === PLAN_IDS.WEEKEND_CARPOOL) {
    const price = interval === 'semester' ? prices.weekend_carpool.semester : prices.weekend_carpool.month
    if (!price) throw err(503, 'prices_not_configured', 'Student plan prices are not configured.')
    return [{ price }]
  }
  if (planId === PLAN_IDS.PERSONALIZED) {
    if (!prices.personalized.product) throw err(503, 'prices_not_configured', 'Student plan prices are not configured.')
    if (!Number.isInteger(priceCents) || priceCents <= 0) throw err(400, 'quote_required', 'A valid quote is required.')
    return [{
      price_data: {
        currency: 'usd',
        product: prices.personalized.product,
        unit_amount: priceCents,
        recurring: interval === 'semester' ? { interval: 'month', interval_count: 4 } : { interval: 'month' },
      },
    }]
  }
  throw err(400, 'bad_plan', 'Unknown plan.')
}

export async function subscribeStudentPlan(sb, user, body, { stripe, now = new Date(), env = process.env, ensureStripeCustomer } = {}) {
  const planId = String(body.planId || '')
  const interval = body.interval === 'semester' ? 'semester' : 'month'
  if (!Object.values(PLAN_IDS).includes(planId)) throw err(400, 'bad_plan', 'Unknown plan.')
  const term = termCode(now)
  const enrollment = one(await sb.from('student_enrollments').select('*').eq('rider_id', user.id).eq('term_code', term).maybeSingle())
  if (!enrollment?.email_verified_at) throw err(403, 'verify_email', 'Verify your clemson.edu email first.')
  const existing = one(await sb.from('student_plan_subscriptions').select('*').eq('rider_id', user.id).maybeSingle())
  if (existing && ['trialing', 'active', 'paused', 'past_due'].includes(existing.status)) throw err(409, 'already_subscribed', 'You already have a plan.')

  let priceCents = null
  let quoteId = null
  if (planId === PLAN_IDS.PERSONALIZED) {
    const quote = one(await sb.from('plan_quotes').select('*').eq('rider_id', user.id).maybeSingle())
    if (!quote || quote.quoted_plan !== PLAN_IDS.PERSONALIZED) throw err(400, 'quote_required', 'No personalized quote yet.')
    if (Date.parse(quote.expires_at) < now.getTime()) throw err(400, 'quote_expired', 'Your quote expired.')
    priceCents = interval === 'semester' ? quote.semester_cents : quote.monthly_cents
    quoteId = quote.id
  } else {
    priceCents = interval === 'semester' ? WEEKEND_CARPOOL_PLAN.semesterCents : WEEKEND_CARPOOL_PLAN.monthlyCents
  }

  const items = subscriptionItems({ planId, interval, priceCents, env })
  if (!stripe) throw err(503, 'payments_unavailable', 'Payments unavailable.')
  await assertClemsonStripeAccount(stripe, env)

  const profile = one(await sb.from('profiles').select('id, email, stripe_customer_id, stripe_default_pm_id').eq('id', user.id).maybeSingle())
  if (!profile?.stripe_default_pm_id) throw err(402, 'card_required', 'Add a card first. The free week needs a card on file.')
  const customerId = profile.stripe_customer_id || (ensureStripeCustomer ? await ensureStripeCustomer(stripe, sb, profile) : null)
  if (!customerId) throw err(503, 'customer_unavailable', 'Could not set up billing.')

  const trialEligible = !existing?.trial_used_at && body.trial !== false
  const sub = await stripe.subscriptions.create({
    customer: customerId,
    items,
    default_payment_method: profile.stripe_default_pm_id,
    ...(trialEligible ? { trial_period_days: TRIAL_DAYS } : {}),
    metadata: { kind: 'student_plan', rider_id: user.id, plan_id: planId, interval, quote_id: quoteId || '' },
  }, { idempotencyKey: `student_plan:${user.id}:${planId}:${interval}:${existing?.updated_at || 'new'}` })

  const row = {
    rider_id: user.id,
    plan_id: planId,
    billing_interval: interval,
    status: sub.status === 'trialing' ? 'trialing' : (sub.status === 'active' ? 'active' : 'pending'),
    quote_id: quoteId,
    price_cents: priceCents,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    stripe_price_id: items[0].price || null,
    trial_started_at: trialEligible ? now.toISOString() : existing?.trial_started_at || null,
    trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    trial_used_at: trialEligible ? now.toISOString() : existing?.trial_used_at || null,
    current_period_end: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
    window_start: existing?.window_start || now.toISOString(),
    updated_at: now.toISOString(),
  }
  one(await sb.from('student_plan_subscriptions').upsert(row, { onConflict: 'rider_id' }))
  if (quoteId) one(await sb.from('plan_quotes').update({ converted_at: now.toISOString() }).eq('id', quoteId))
  return { ok: true, status: row.status, trial: trialEligible, trialEndsAt: row.trial_ends_at }
}

export async function pauseStudentPlan(sb, user, body, { stripe, now = new Date(), env = process.env } = {}) {
  const sub = one(await sb.from('student_plan_subscriptions').select('*').eq('rider_id', user.id).maybeSingle())
  if (!sub || !['active', 'trialing'].includes(sub.status)) throw err(400, 'no_active_plan', 'No active plan to pause.')
  const v = validatePause({ kind: body.kind, start: body.start, end: body.end }, pauseWindowsFromEnv(env))
  if (!v.ok) throw err(400, v.code, 'That pause is not available.')
  one(await sb.from('subscription_pauses').insert({ rider_id: user.id, kind: v.kind, start_date: v.start, end_date: v.end }))
  if (stripe && sub.stripe_subscription_id) {
    const resumesAt = Math.floor((Date.parse(v.end) + 86400000) / 1000)
    await stripe.subscriptions.update(sub.stripe_subscription_id, { pause_collection: { behavior: 'void', resumes_at: resumesAt } })
  }
  const startsNow = v.start <= now.toISOString().slice(0, 10)
  if (startsNow) one(await sb.from('student_plan_subscriptions').update({ status: 'paused', paused_at: now.toISOString(), updated_at: now.toISOString() }).eq('rider_id', user.id))
  return { ok: true, pause: v }
}

export async function resumeStudentPlan(sb, user, { stripe, now = new Date() } = {}) {
  const sub = one(await sb.from('student_plan_subscriptions').select('*').eq('rider_id', user.id).maybeSingle())
  if (!sub) throw err(400, 'no_plan', 'No plan.')
  const today = now.toISOString().slice(0, 10)
  one(await sb.from('subscription_pauses').update({ canceled_at: now.toISOString() }).eq('rider_id', user.id).is('canceled_at', null).gte('end_date', today))
  if (stripe && sub.stripe_subscription_id) await stripe.subscriptions.update(sub.stripe_subscription_id, { pause_collection: '' })
  one(await sb.from('student_plan_subscriptions').update({ status: 'active', paused_at: null, updated_at: now.toISOString() }).eq('rider_id', user.id))
  return { ok: true }
}

export async function cancelStudentPlan(sb, user, { stripe, now = new Date() } = {}) {
  const sub = one(await sb.from('student_plan_subscriptions').select('*').eq('rider_id', user.id).maybeSingle())
  if (!sub) throw err(400, 'no_plan', 'No plan.')
  if (stripe && sub.stripe_subscription_id) await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: true })
  one(await sb.from('student_plan_subscriptions').update({ cancel_at_period_end: true, updated_at: now.toISOString() }).eq('rider_id', user.id))
  return { ok: true, cancelAtPeriodEnd: true }
}

export async function unsubscribePlanEmails(sb, token) {
  if (!token || !/^[a-f0-9]{16,64}$/i.test(token)) return { ok: false }
  const q = one(await sb.from('plan_quotes').select('rider_id').eq('unsubscribe_token', token).maybeSingle())
  if (!q) return { ok: false }
  one(await sb.from('student_plan_email_optouts').upsert({ rider_id: q.rider_id }, { onConflict: 'rider_id' }))
  return { ok: true }
}

// ---------- webhook ----------

export function studentPlanMeta(obj) {
  const meta = obj?.metadata || obj?.subscription_details?.metadata || obj?.parent?.subscription_details?.metadata
  return meta?.kind === 'student_plan' ? meta : null
}

const STATUS_MAP = { trialing: 'trialing', active: 'active', past_due: 'past_due', unpaid: 'past_due', canceled: 'canceled', incomplete_expired: 'canceled', incomplete: 'pending', paused: 'paused' }

/** Referral: when the referred student subscribes (first paid invoice), both get one free ride credit. */
export async function grantStudentPlanReferral(sb, riderId, { env = process.env, subscriptionId = null, creditStore } = {}) {
  const prof = one(await sb.from('profiles').select('referred_by').eq('id', riderId).maybeSingle())
  const referrer = prof?.referred_by
  if (!referrer) return { granted: false, reason: 'no_referrer' }
  const cents = Number.parseInt(env.STUDENT_PLAN_REFERRAL_CREDIT_CENTS, 10) || REFERRAL_CREDIT_CENTS_DEFAULT
  const ins = await sb.from('student_plan_referral_rewards').insert({ referred_id: riderId, referrer_id: referrer, reward_cents: cents, stripe_subscription_id: subscriptionId })
  if (ins.error) {
    if (String(ins.error.code) === '23505') return { granted: false, reason: 'already_granted' }
    throw err(500, 'db_error', ins.error.message)
  }
  const store = creditStore || supabaseCreditStore(sb)
  const a = await store.applyCredits(referrer, cents, { kind: 'student_plan_referral', idempotencyKey: `student_plan_referral:${riderId}:referrer` })
  const b = await store.applyCredits(riderId, cents, { kind: 'student_plan_referral', idempotencyKey: `student_plan_referral:${riderId}:referred` })
  return { granted: Boolean(a.ok && b.ok), referrer, cents }
}

export async function syncStudentPlanFromStripe(sb, eventType, obj, { env = process.env, now = new Date(), creditStore } = {}) {
  const meta = studentPlanMeta(obj)
  if (!meta?.rider_id) return { ok: true, skipped: true, reason: 'not_student_plan' }
  const riderId = meta.rider_id
  if (eventType.startsWith('customer.subscription.')) {
    const status = eventType === 'customer.subscription.deleted' ? 'canceled' : (obj.pause_collection ? 'paused' : (STATUS_MAP[obj.status] || 'pending'))
    const patch = {
      status,
      cancel_at_period_end: Boolean(obj.cancel_at_period_end),
      current_period_end: obj.current_period_end ? new Date(obj.current_period_end * 1000).toISOString() : null,
      updated_at: now.toISOString(),
    }
    const r = await sb.from('student_plan_subscriptions').update(patch).eq('rider_id', riderId).eq('stripe_subscription_id', obj.id)
    if (r.error) return { ok: false, error: r.error.message }
    return { ok: true, status }
  }
  if (eventType === 'invoice.paid') {
    const r = await sb.from('student_plan_subscriptions').update({ status: 'active', updated_at: now.toISOString() }).eq('rider_id', riderId)
    if (r.error) return { ok: false, error: r.error.message }
    let referral = { granted: false, reason: 'zero_invoice' }
    if ((obj.amount_paid || 0) > 0) referral = await grantStudentPlanReferral(sb, riderId, { env, subscriptionId: obj.subscription || null, creditStore })
    return { ok: true, status: 'active', referral }
  }
  if (eventType === 'invoice.payment_failed') {
    const r = await sb.from('student_plan_subscriptions').update({ status: 'past_due', updated_at: now.toISOString() }).eq('rider_id', riderId)
    if (r.error) return { ok: false, error: r.error.message }
    return { ok: true, status: 'past_due' }
  }
  return { ok: true, skipped: true, reason: 'unhandled_type' }
}
