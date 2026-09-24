/**
 * Rider deposit, student, and promo helpers.
 * Quote and checkout go through the existing payment router.
 * Deposit is always 25% of the current cash remainder (Stripe minimum included).
 */
import { normalizePromoCode } from './authErrors.js'
import {
  STUDENT_CONFIRM_EMAIL_COPY,
  STUDENT_EMAIL_REQUIRED_COPY,
  emailConfirmationState,
  isClemsonEmail,
} from '../../src/lib/studentDomain.js'
import { authedJson } from './apiClient.js'
import {
  AIRPORT_ROUTE_FALLBACK,
  cardDepositCents,
  depositSplit,
  quoteFare,
  resolveSurge,
  STRIPE_NOT_CONFIGURED_COPY,
} from '../../src/lib/fareRates.js'
import { CLT, GSP, STADIUM } from './places.js'

export { STRIPE_NOT_CONFIGURED_COPY }

export { cardDepositCents }

export const STUDENT_DISCOUNT_BPS = 1000
export const STUDENT_DISCOUNT_LABEL = 'Clemson student · 10% off Standard'
export const STUDENT_EMAIL_HINT = 'Needs a confirmed @clemson.edu or @g.clemson.edu email.'
export const STUDENT_CLAIM_COPY =
  '10% off Standard applies when the signed-in email ends with @clemson.edu or @g.clemson.edu and that address is already confirmed. Confirm and Schedule use that price. There is no separate student ID check.'
export { STUDENT_EMAIL_REQUIRED_COPY, STUDENT_CONFIRM_EMAIL_COPY }
export const NATIVE_CHECKOUT_ORIGIN = 'https://clemson-airport-rides.vercel.app'

export const AIRPORT_CHOICES = [
  { code: 'GSP', name: 'Greenville-Spartanburg' },
  { code: 'CLT', name: 'Charlotte Douglas' },
]

const AIRPORT_DEST = {
  GSP: { label: 'Greenville-Spartanburg International (GSP)', lat: GSP.latitude, lng: GSP.longitude },
  CLT: { label: 'Charlotte Douglas International (CLT)', lat: CLT.latitude, lng: CLT.longitude },
}

export function recomputeDeposit({ fareCents, cashCents } = {}) {
  const fare = Math.max(0, Math.round(Number(fareCents) || 0))
  const cash = cashCents == null ? fare : Math.max(0, Math.round(Number(cashCents) || 0))
  return {
    fareCents: fare,
    cashCents: cash,
    depositCents: cardDepositCents(cash),
  }
}

export function formatUsdCents(cents) {
  const n = Math.round(Number(cents) || 0)
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  const dollars = Math.floor(abs / 100).toLocaleString('en-US')
  const rem = String(abs % 100).padStart(2, '0')
  return `${sign}$${dollars}.${rem}`
}

/** Fare already includes any Standard student discount. Stored deposit cents win, including 0. */
export function depositBalance({ fareCents, depositCents } = {}) {
  return depositSplit(fareCents, depositCents)
}

export function airportCodeFromLabel(label) {
  const text = String(label || '')
  if (/gsp|greenville/i.test(text)) return 'GSP'
  if (/\bclt\b|charlotte/i.test(text)) return 'CLT'
  return null
}

export function depositSurfaceCopy(input, surface, { studentDiscountCents = 0 } = {}) {
  const balance = input?.remainingCents == null ? depositBalance(input) : {
    fareCents: Math.max(0, Math.round(Number(input.fareCents) || 0)),
    depositCents: Math.max(0, Math.round(Number(input.depositCents) || 0)),
    remainingCents: Math.max(0, Math.round(Number(input.remainingCents) || 0)),
  }
  if (balance.depositCents <= 0) return null
  const fare = formatUsdCents(balance.fareCents)
  const deposit = formatUsdCents(balance.depositCents)
  const remaining = formatUsdCents(balance.remainingCents)
  const student = Math.round(Number(studentDiscountCents) || 0) > 0
    ? ' The 10% Standard student discount is already in that fare.'
    : ''
  switch (surface) {
    case 'quote':
      return `Full fare ${fare}. Pay the 25% deposit of ${deposit} now. Remaining balance ${remaining} is collected when the trip is complete.${student}`
    case 'confirm':
      return `Airport fare ${fare}. 25% deposit ${deposit}. Remaining balance ${remaining} is due when the trip is complete.${student}`
    case 'receipt':
      return `25% deposit ${deposit}. Remaining balance ${remaining}.${student}`
    case 'upcoming':
      return `Deposit ${deposit} · remaining balance ${remaining}`
    default: {
      const unknown = surface
      throw new Error(`Unknown deposit surface: ${unknown}`)
    }
  }
}

export function depositReceiptLines(trip) {
  const stored = trip?.deposit_cents
  if (stored == null || stored === '') return []
  const balance = depositBalance({ fareCents: trip?.fare_cents, depositCents: stored })
  if (balance.depositCents <= 0) return []
  return [
    `25% deposit: ${formatUsdCents(balance.depositCents)}`,
    `Remaining balance: ${formatUsdCents(balance.remainingCents)}`,
  ]
}

export function checkoutFailureCopy(err) {
  const payloadMessage = String(err?.payload?.message || '')
  const message = String(err?.message || '')
  const combined = `${payloadMessage} ${message}`
  if (/not configured|payments unavailable/i.test(combined)) return STRIPE_NOT_CONFIGURED_COPY
  return message || 'Checkout failed. No charge was made.'
}

export function studentDiscountCents(fareCents, { isStudent = false, tier = 'standard' } = {}) {
  const base = Math.max(0, Math.round(Number(fareCents) || 0))
  if (!isStudent || (tier && tier !== 'standard')) {
    return { fareCents: base, discountCents: 0, label: null }
  }
  const discountCents = Math.round((base * STUDENT_DISCOUNT_BPS) / 10000)
  return {
    fareCents: base - discountCents,
    discountCents,
    label: STUDENT_DISCOUNT_LABEL,
  }
}

/** Catalog or surged dollar price with the Standard student discount applied. */
export function displayTierPrice(priceDollars, { isStudent = false, tier = 'standard', surgeMultiplier = 1 } = {}) {
  const surge = Number(surgeMultiplier)
  const factor = Number.isFinite(surge) && surge > 0 ? surge : 1
  const list = Math.round(Math.max(0, Number(priceDollars) || 0) * factor * 100) / 100
  const priced = studentDiscountCents(Math.round(list * 100), { isStudent, tier })
  return {
    price: priced.fareCents / 100,
    discount: priced.discountCents / 100,
    label: priced.label,
    fareCents: priced.fareCents,
    discountCents: priced.discountCents,
  }
}

/** Metadata stored on a requested trip. Discount cents apply to Standard only. */
export function studentTripMeta({ isStudent = false, tier = 'standard', fareCents = 0 } = {}) {
  if (!isStudent) return {}
  const priced = studentDiscountCents(fareCents, { isStudent: true, tier })
  if (priced.discountCents <= 0) return { isStudent: true }
  return {
    isStudent: true,
    studentLabel: priced.label,
    student_discount_cents: priced.discountCents,
  }
}

export function studentStatus({ email, studentVerifiedAt, user } = {}) {
  const address = user?.email || email || null
  const viaEmail = isClemsonEmail(address)
  const confirmation = user ? emailConfirmationState(user) : 'unknown'
  const verified = user ? viaEmail && confirmation === 'confirmed' : viaEmail
  let gateCopy = null
  if (!verified) {
    gateCopy = viaEmail && confirmation !== 'confirmed'
      ? STUDENT_CONFIRM_EMAIL_COPY
      : STUDENT_EMAIL_REQUIRED_COPY
  }
  return {
    verified,
    viaEmail,
    confirmed: confirmation === 'confirmed',
    verifiedAt: verified ? (studentVerifiedAt || null) : null,
    discountLabel: verified ? STUDENT_DISCOUNT_LABEL : null,
    gateCopy,
  }
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export function parseQuoteResponse(data) {
  const quote = data?.quote && typeof data.quote === 'object' ? data.quote : {}
  const breakdown = quote.breakdown && typeof quote.breakdown === 'object' ? quote.breakdown : {}
  const fareCents = num(quote.fareCents ?? data?.fareCents)
  const cashCents = quote.cashCents == null ? fareCents : num(quote.cashCents)
  const surge = data?.surge && typeof data.surge === 'object' ? data.surge : null
  const rule = surge?.rule && typeof surge.rule === 'object' ? surge.rule : null
  return {
    ...recomputeDeposit({ fareCents, cashCents }),
    studentDiscountCents: num(breakdown.student_discount_cents),
    surgeMultiplier: num(surge?.multiplier) || 1,
    surgeLabel: rule?.label || null,
    routeSource: data?.routeSource || null,
  }
}

export function quoteInputKey({ airport, date, time } = {}) {
  const code = airport === 'CLT' ? 'CLT' : 'GSP'
  const day = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : ''
  const clock = /^\d{2}:\d{2}$/.test(time || '') ? time : ''
  return `${code}|${day}|${clock}`
}

export function quoteAtIso({ date, time } = {}, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return now.toISOString()
  const clock = /^\d{2}:\d{2}$/.test(time || '') ? time : '12:00'
  const parsed = new Date(`${date}T${clock}:00`)
  if (Number.isNaN(parsed.getTime())) return now.toISOString()
  return parsed.toISOString()
}

export function paymentRouteMissing(err) {
  if (err?.payload?.tripId) return false
  const message = `${err?.message || ''} ${err?.payload?.message || ''}`
  if (/stripe_secret_key|checkout cannot start|payments unavailable/i.test(message)) return false
  if (err?.status === 404 || /unknown payment|not_found/i.test(message)) return true
  return err?.status === 503 && /not configured|service_role/i.test(message)
}

/** Offline preview from the shared fare card when the quote route is not deployed yet. */
export function previewAirportFare({ airport, date, time, isStudent = false, at } = {}) {
  const code = airport === 'CLT' ? 'CLT' : 'GSP'
  const fb = AIRPORT_ROUTE_FALLBACK[code]
  const when = at instanceof Date ? at : new Date(quoteAtIso({ date, time }))
  const surge = resolveSurge({ at: when, airport: true, gameDayMultiplier: null })
  const quoted = quoteFare({
    miles: fb.miles,
    minutes: fb.minutes,
    surgeMultiplier: surge.multiplier,
    isStudent: Boolean(isStudent),
    tier: 'standard',
  })
  return {
    ...parseQuoteResponse({ quote: quoted, surge, routeSource: 'fallback' }),
    source: 'fallback',
  }
}

export async function quoteAirportFare(supabase, { airport, date, time, isStudent = false } = {}) {
  try {
    const data = await authedJson(supabase, '/api/stripe-payment-methods?action=quote', {
      method: 'POST',
      body: {
        airport: airport === 'CLT' ? 'CLT' : 'GSP',
        at: quoteAtIso({ date, time }),
        tier: 'standard',
        isStudent: Boolean(isStudent),
      },
    })
    return { ...parseQuoteResponse(data), source: 'api' }
  } catch (err) {
    if (!paymentRouteMissing(err)) throw err
    return previewAirportFare({ airport, date, time, isStudent })
  }
}

function scheduledIso({ date, time }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return null
  const clock = /^\d{2}:\d{2}$/.test(time || '') ? time : '12:00'
  const parsed = new Date(`${date}T${clock}:00`)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

async function insertAirportTrip(supabase, params) {
  const code = params.airport === 'CLT' ? 'CLT' : 'GSP'
  const dest = AIRPORT_DEST[code]
  const scheduledFor = scheduledIso(params)
  const studentDiscountCents = Math.max(0, Math.round(Number(params.studentDiscountCents) || 0))
  const { data, error } = await supabase
    .from('trips')
    .insert({
      rider_id: params.riderId,
      status: scheduledFor ? 'scheduled' : 'searching',
      tier: 'standard',
      pickup_label: 'Memorial Stadium',
      dropoff_label: dest.label,
      pickup_lat: STADIUM.latitude,
      pickup_lng: STADIUM.longitude,
      dropoff_lat: dest.lat,
      dropoff_lng: dest.lng,
      fare_cents: params.fareCents,
      deposit_cents: params.depositCents,
      passengers: 1,
      pickup_at: scheduledFor,
      scheduled_for: scheduledFor,
      rider_note: scheduledFor ? 'airport' : null,
      metadata: {
        kind: scheduledFor ? 'scheduled' : 'airport',
        purpose: 'airport',
        airport: code,
        isStudent: studentDiscountCents > 0,
        student_discount_cents: studentDiscountCents,
      },
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message || 'Could not create trip')
  return data.id
}

async function startLegacyDeposit(supabase, params) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!params.riderId) throw new Error('Sign in required')
  const code = params.airport === 'CLT' ? 'CLT' : 'GSP'
  const tripId = await insertAirportTrip(supabase, params)
  try {
    const session = await authedJson(supabase, '/api/create-checkout-session', {
      method: 'POST',
      body: {
        airport: code,
        fareCents: params.fareCents,
        depositCents: params.depositCents,
        riderName: params.riderName || 'Rider',
        riderId: params.riderId,
        tripId,
        successUrl: `${NATIVE_CHECKOUT_ORIGIN}/#/schedule?paid=1&trip=${tripId}`,
        cancelUrl: `${NATIVE_CHECKOUT_ORIGIN}/#/schedule?canceled=1&trip=${tripId}`,
      },
    })
    return {
      ...session,
      tripId,
      fareCents: params.fareCents,
      depositCents: params.depositCents,
      legacy: true,
    }
  } catch (err) {
    await supabase
      .from('trips')
      .update({ status: 'canceled', canceled_at: new Date().toISOString() })
      .eq('id', tripId)
      .in('status', ['searching', 'scheduled'])
    throw err
  }
}

export async function startAirportDeposit(supabase, params = {}) {
  const code = params.airport === 'CLT' ? 'CLT' : 'GSP'
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.date || '') ? params.date : undefined
  const clock = /^\d{2}:\d{2}$/.test(params.time || '') ? params.time : undefined
  try {
    return await authedJson(supabase, '/api/stripe-payment-methods?action=airport-checkout', {
      method: 'POST',
      body: {
        airport: code,
        date: day,
        time: day ? (clock || '12:00') : undefined,
        useCredits: true,
        origin: NATIVE_CHECKOUT_ORIGIN,
      },
    })
  } catch (err) {
    if (!paymentRouteMissing(err)) throw err
    return startLegacyDeposit(supabase, params)
  }
}

export function depositSettled(payments) {
  return (payments || []).some((row) => {
    const kind = String(row?.kind || '')
    const status = String(row?.status || '')
    const isDeposit = kind === 'deposit' || kind === 'airport_deposit'
    return isDeposit && /succeeded|paid|complete/i.test(status)
  })
}

export function promoClaimMessage(result) {
  if (!result || typeof result !== 'object') return 'Promo claim did not return a result.'
  if (result.error) return String(result.error)
  if (result.claimed) return 'Code saved. Ride credit is added only after your first completed ride.'
  if (result.reason === 'already_referred') return 'This account already has a promo code.'
  if (result.reason === 'no_code') return 'Enter a promo code.'
  return 'Promo saved.'
}

export function describeRiderSocialRewards(cfg) {
  const referrerCents = num(cfg?.referrer_credit_cents ?? 500) || 500
  const kind = cfg?.referred_discount_kind === 'fixed' ? 'fixed' : 'percent'
  const referred = kind === 'fixed'
    ? `$${(num(cfg?.referred_cents_off ?? 500) / 100).toFixed(2)} ride credit`
    : `${num(cfg?.referred_percent_off ?? 20) || 20}% of the first-ride fare as ride credit`
  return {
    referrer: `$${(referrerCents / 100).toFixed(2)} ride credit`,
    referred,
  }
}

export function riderPromoShareUrl(code) {
  const norm = normalizePromoCode(code)
  return `https://clemson-airport-rides.vercel.app/#/sign-up?ref=${encodeURIComponent(norm)}`
}

export function riderPromoShareText(code) {
  return `Join me on Clemson RIDES. Use code ${normalizePromoCode(code)} when you sign up.`
}

export async function claimPromoCode(supabase, code) {
  if (!supabase) throw new Error('Supabase is not configured')
  const norm = normalizePromoCode(code)
  const { data, error } = await supabase.rpc('claim_rider_social_promo', { p_code: norm })
  if (error) throw new Error(error.message)
  return data || { ok: false, error: 'Promo claim failed' }
}

export async function loadPromoDesk(supabase, userId) {
  if (!supabase || !userId) return { code: null, config: null, sent: [], received: null, error: 'Sign in required' }
  let code = null
  let codeError = null
  const { data: codeData, error: codeErr } = await supabase.rpc('ensure_rider_social_code')
  if (codeErr) codeError = codeErr.message
  else code = typeof codeData === 'string' ? codeData : null

  const [cfgRes, refsRes] = await Promise.all([
    supabase.from('rider_referral_config').select('*').eq('type', 'rider_social').maybeSingle(),
    supabase
      .from('rider_referrals')
      .select('id, status, code, referrer_id, referred_id, referrer_first_name, referred_first_name, created_at, rewarded_at')
      .eq('type', 'rider_social')
      .or(`referrer_id.eq.${userId},referred_id.eq.${userId}`)
      .order('created_at', { ascending: false }),
  ])

  const referrals = refsRes.data || []
  return {
    code,
    config: cfgRes.data || null,
    sent: referrals.filter((row) => row.referrer_id === userId),
    received: referrals.find((row) => row.referred_id === userId) || null,
    error: codeError || refsRes.error?.message || cfgRes.error?.message || null,
  }
}

export async function markStudentVerified(supabase, user) {
  if (!supabase || !user?.id) return { verified: false, error: 'Sign in required' }
  if (!isClemsonEmail(user.email)) {
    return { verified: false, error: STUDENT_EMAIL_REQUIRED_COPY }
  }
  if (emailConfirmationState(user) !== 'confirmed') {
    return { verified: false, error: STUDENT_CONFIRM_EMAIL_COPY }
  }
  const now = new Date().toISOString()
  const email = String(user.email).trim().toLowerCase()
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ student_verified_at: now, email, updated_at: now })
    .eq('id', user.id)
  if (profileError) return { verified: false, error: profileError.message }

  const { error: upsertError } = await supabase.from('student_verifications').upsert(
    { profile_id: user.id, email, verified_at: now },
    { onConflict: 'profile_id' },
  )
  if (!upsertError) return { verified: true, verifiedAt: now, error: null }

  const { data: existing } = await supabase
    .from('student_verifications')
    .select('id')
    .eq('profile_id', user.id)
    .maybeSingle()
  if (existing?.id) {
    const { error: upErr } = await supabase
      .from('student_verifications')
      .update({ email, verified_at: now })
      .eq('profile_id', user.id)
    return { verified: true, verifiedAt: now, error: upErr?.message || null }
  }
  const { error: insErr } = await supabase.from('student_verifications').insert({
    profile_id: user.id,
    email,
    verified_at: now,
  })
  return { verified: true, verifiedAt: now, error: insErr?.message || null }
}

export async function loadStudentProfile(supabase, userId) {
  if (!supabase || !userId) return { studentVerifiedAt: null, email: null, error: 'Sign in required' }
  const { data, error } = await supabase
    .from('profiles')
    .select('student_verified_at, email')
    .eq('id', userId)
    .maybeSingle()
  if (error) return { studentVerifiedAt: null, email: null, error: error.message }
  return {
    studentVerifiedAt: data?.student_verified_at || null,
    email: data?.email || null,
    error: null,
  }
}

export async function loadRiderBilling(supabase, userId) {
  if (!supabase || !userId) {
    return { card: null, deposits: [], rides: [], paymentsError: null, ridesError: null, profileError: 'Sign in required' }
  }
  const [profileRes, payRes, tripRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('stripe_card_brand, stripe_card_last4, stripe_default_pm_id, billing_activated_at')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('payments')
      .select('id, kind, amount_cents, status, created_at, trip_id')
      .eq('rider_id', userId)
      .order('created_at', { ascending: false })
      .limit(40),
    supabase
      .from('trips')
      .select('id, status, pickup_label, dropoff_label, fare_cents, deposit_cents, created_at')
      .eq('rider_id', userId)
      .order('created_at', { ascending: false })
      .limit(20),
  ])
  const profile = profileRes.data
  const card = profile?.stripe_card_last4 || profile?.stripe_default_pm_id
    ? {
        brand: profile.stripe_card_brand || 'card',
        last4: profile.stripe_card_last4 || null,
        billingActivatedAt: profile.billing_activated_at || null,
      }
    : null
  const payments = payRes.data || []
  return {
    card,
    deposits: payments.filter((row) => row.kind === 'deposit'),
    charges: payments,
    rides: tripRes.data || [],
    profileError: profileRes.error?.message || null,
    paymentsError: payRes.error?.message || null,
    ridesError: tripRes.error?.message || null,
  }
}

export async function loadTripDeposit(supabase, tripId) {
  if (!supabase || !tripId) return { settled: false, payments: [], error: null }
  const { data, error } = await supabase
    .from('payments')
    .select('id, kind, amount_cents, status, trip_id')
    .eq('trip_id', tripId)
  if (error) return { settled: false, payments: [], error: error.message }
  const payments = data || []
  return { settled: depositSettled(payments), payments, error: null }
}
