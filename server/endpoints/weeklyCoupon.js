/**
 * GET  /api/weekly-coupon — this week's coupon and the standing offers.
 * GET or POST from cron — Friday 12:00 America/New_York email + Expo push.
 *
 * Cron auth matches driver payouts: Bearer CRON_SECRET. On Vercel the
 * x-vercel-cron header selects the cron path and the bearer is still required.
 * Off Vercel the bearer alone runs the drop. ?dry_run=1 does not send.
 *
 * Env: RESEND_API_KEY, RESEND_FROM, EXPO_ACCESS_TOKEN (optional; push is
 * skipped with reason expo_access_token_missing), CRON_SECRET,
 * SUPABASE_SERVICE_ROLE_KEY for the recipient list and the drop claim.
 */
import { readDriverPushTokens } from '../driverPushToken.js'
import { admin, cors, json } from '../friendRideLib.js'
import { stagingCronBlock } from '../cronGuard.js'
import { cronAuthorized, isVercelCron, runningOnVercel } from './driverPayouts.js'
import { STANDING_OFFERS, selectRideDiscount } from '../../shared/standingPromos.js'
import { currentWeeklyCoupon, FRIDAY_DROP_HOUR_ET, FRIDAY_DROP_TIME_ZONE } from '../../shared/weeklyCoupon.js'
import { runFridayDrop } from '../weeklyCouponDrop.js'

function flagOn(value) {
  const v = String(value ?? '').trim().toLowerCase()
  return v === '1' || v === 'true'
}

function dryRunRequested(req) {
  const query = req?.query
  if (query && typeof query === 'object') {
    const raw = query.dry_run ?? query.dryRun
    const value = Array.isArray(raw) ? raw[0] : raw
    if (flagOn(value)) return true
  }
  const url = String(req?.url || '')
  const qIndex = url.indexOf('?')
  if (qIndex === -1) return false
  return flagOn(new URLSearchParams(url.slice(qIndex + 1)).get('dry_run'))
}

function publicPayload(now) {
  return {
    dropHourEt: FRIDAY_DROP_HOUR_ET,
    timeZone: FRIDAY_DROP_TIME_ZONE,
    coupon: currentWeeklyCoupon(now),
    standingOffers: STANDING_OFFERS,
  }
}

function rows(result) {
  if (!result || result.error) return []
  return result.data || []
}

export function supabaseDropStore(sb) {
  return {
    async find(dropKey) {
      const result = await sb.from('weekly_coupon_drops').select('drop_key, coupon_id').eq('drop_key', dropKey).maybeSingle()
      if (result?.error) {
        const message = result.error.message || ''
        if (/weekly_coupon_drops|schema cache|does not exist/i.test(message)) return null
        throw new Error(message)
      }
      return result?.data || null
    },
    async claim(dropKey, coupon) {
      const result = await sb.from('weekly_coupon_drops').insert({
        drop_key: dropKey,
        coupon_id: coupon.id,
        code: coupon.code,
        concept_id: coupon.conceptId,
      }).select('drop_key')
      if (result?.error) {
        if (String(result.error.code) === '23505') return false
        throw new Error(result.error.message || 'drop claim failed')
      }
      return true
    },
    async listRecipients() {
      const result = await sb
        .from('profiles')
        .select('id, email, full_name, deleted_at')
        .not('email', 'is', null)
        .limit(500)
      return rows(result)
    },
    async listPushTokens() {
      const tokens = await readDriverPushTokens(sb)
      return [...tokens.values()].map((row) => row.token).filter((token) => /^Expo(nent)?PushToken\[/.test(token || ''))
    },
  }
}

async function riderContext(sb, userId) {
  if (!sb || !userId) return null
  const trips = await sb
    .from('trips')
    .select('id, status, fare_cents, metadata')
    .eq('rider_id', userId)
    .limit(200)
  const referrals = await sb
    .from('rider_referrals')
    .select('referred_id, status')
    .eq('referrer_id', userId)
    .limit(50)
  const referredIds = rows(referrals).map((row) => row.referred_id).filter(Boolean)
  let friends = []
  if (referredIds.length && typeof sb.auth?.admin?.getUserById === 'function') {
    friends = []
    for (const id of referredIds) {
      const loaded = await sb.auth.admin.getUserById(id)
      if (loaded?.data?.user) friends.push(loaded.data.user)
    }
  }
  const rideRows = rows(trips).map((row) => ({
    status: row.status,
    fareCents: row.fare_cents,
    thresholdRedeemed: Boolean(row.metadata?.threshold_promo_redeemed),
    freeRideRedeemed: Boolean(row.metadata?.edu_free_ride_redeemed),
  }))
  return selectRideDiscount({
    fareCents: 0,
    rides: rideRows,
    eduFriends: friends,
    thresholdRedeemed: rideRows.some((row) => row.thresholdRedeemed),
    freeRideRedeemed: rideRows.some((row) => row.freeRideRedeemed),
    coupon: currentWeeklyCoupon(),
  })
}

export default async function handler(req, res, deps = {}) {
  if (cors(req, res)) return
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader?.('Allow', 'GET, POST, OPTIONS')
    return json(res, 405, { error: 'Method not allowed' })
  }

  const env = deps.env || process.env
  const now = deps.now instanceof Date ? deps.now : new Date()
  const secretArg = deps.cronSecret !== undefined ? deps.cronSecret : env.CRON_SECRET
  const bearerOk = deps.cronAuthorized ? deps.cronAuthorized(req) : cronAuthorized(req, secretArg)
  const onVercel = runningOnVercel(env)
  const cronHeader = isVercelCron(req)
  const cronPath = (onVercel && cronHeader) || (!onVercel && bearerOk && (req.method === 'POST' || cronHeader || dryRunRequested(req)))
  const explicitRun = req.method === 'POST' && bearerOk

  if (req.method === 'POST' && !bearerOk) {
    return json(res, 401, { skipped: true, reason: 'Set CRON_SECRET to run the Friday coupon drop' })
  }

  if (cronPath || explicitRun) {
    if (!bearerOk) {
      return json(res, 200, { skipped: true, reason: 'Set CRON_SECRET to run the Friday coupon drop' })
    }
    const dryRun = dryRunRequested(req) || deps.dryRun === true
    const blocked = stagingCronBlock(env, { dryRun })
    if (blocked) return json(res, blocked.status, blocked.body)
    const sb = deps.sb !== undefined ? deps.sb : admin()
    if (!sb && !deps.store) {
      return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
    }
    const result = await runFridayDrop({
      now,
      env,
      store: deps.store || supabaseDropStore(sb),
      fetchImpl: deps.fetchImpl,
      force: deps.force === true,
      dryRun,
    })
    return json(res, 200, result)
  }

  const payload = publicPayload(now)
  const sb = deps.sb
  const user = deps.user
  if (sb && user?.id) {
    try {
      payload.standingPromo = await riderContext(sb, user.id)
    } catch {
      payload.standingPromo = null
    }
  }
  return json(res, 200, payload)
}
