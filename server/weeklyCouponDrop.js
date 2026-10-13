/**
 * Friday noon ET drop.
 * Emails active profiles through Resend when RESEND_API_KEY and RESEND_FROM
 * are set. Expo push runs only when EXPO_ACCESS_TOKEN is set; otherwise the
 * result records expo_access_token_missing and email still proceeds.
 * In-app toasts are delivered on the rider's next signed-in session
 * (src/components/WeeklyCouponNotice.jsx), once per coupon id.
 */
import { emailSenderConfigured } from '../shared/agreementSign.js'
import {
  currentWeeklyCoupon,
  fridayDropEmail,
  isFridayDropWindow,
} from '../shared/weeklyCoupon.js'

export function expoPushConfigured(env = {}) {
  const token = String(env.EXPO_ACCESS_TOKEN || '').trim()
  return Boolean(token && !token.includes('placeholder'))
}

export function isActivePromoRecipient(profile) {
  const email = String(profile?.email || '').trim()
  if (!email || !email.includes('@')) return false
  if (profile.deleted_at || profile.deactivated_at || profile.banned_at) return false
  return true
}

export async function sendResendPromo({ to, subject, text, env, fetchImpl }) {
  const fetcher = fetchImpl || globalThis.fetch
  const res = await fetcher('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${String(env.RESEND_API_KEY).trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: String(env.RESEND_FROM).trim(),
      to: [to],
      subject,
      text,
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const message = body.message || body.error || 'email not sent'
    throw new Error(typeof message === 'string' ? message : 'email not sent')
  }
  return { id: body.id || null }
}

export async function sendExpoPush({ tokens, title, body, env, fetchImpl }) {
  if (!expoPushConfigured(env)) return { sent: false, reason: 'expo_access_token_missing', count: 0 }
  const list = [...new Set((tokens || []).map((token) => String(token || '').trim()).filter(Boolean))]
  if (!list.length) return { sent: false, reason: 'no_push_tokens', count: 0 }
  const fetcher = fetchImpl || globalThis.fetch
  const res = await fetcher('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${String(env.EXPO_ACCESS_TOKEN).trim()}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(list.map((to) => ({
      to,
      title,
      body,
      sound: 'default',
      data: { kind: 'promo_weekly' },
    }))),
  })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) return { sent: false, reason: 'expo_push_failed', count: 0 }
  return { sent: true, reason: null, count: list.length, id: payload?.data?.[0]?.id || null }
}

/**
 * @param {object} args
 * @param {Date} args.now
 * @param {object} args.env
 * @param {{ find: Function, claim: Function, listRecipients: Function, listPushTokens: Function }} args.store
 * @param {boolean} [args.force] skip the Friday noon gate (tests and a manual replay)
 * @param {boolean} [args.dryRun]
 */
export async function runFridayDrop({
  now = new Date(),
  env = process.env,
  store,
  fetchImpl,
  force = false,
  dryRun = false,
} = {}) {
  const coupon = currentWeeklyCoupon(now)
  if (!force && !isFridayDropWindow(now)) {
    return { ok: true, skipped: true, reason: 'outside_friday_drop_hour', coupon, inApp: 'toast_on_next_open' }
  }
  if (!store) return { ok: false, skipped: true, reason: 'store_missing', coupon }

  const existing = await store.find(coupon.dropKey)
  if (existing) {
    return { ok: true, skipped: true, reason: 'already_dropped', coupon, inApp: 'toast_on_next_open' }
  }

  const recipients = (await store.listRecipients()).filter(isActivePromoRecipient)
  const mailReady = emailSenderConfigured(env)
  const pushReady = expoPushConfigured(env)
  const tokens = pushReady ? await store.listPushTokens() : []

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      skipped: false,
      coupon,
      recipients: recipients.length,
      email: { sent: false, reason: mailReady ? 'dry_run' : 'resend_not_configured' },
      push: pushReady
        ? { sent: false, reason: 'dry_run', count: tokens.length }
        : { sent: false, reason: 'expo_access_token_missing', count: 0 },
      inApp: 'toast_on_next_open',
    }
  }

  if (!mailReady) {
    return {
      ok: true,
      skipped: true,
      reason: 'resend_not_configured',
      coupon,
      recipients: recipients.length,
      push: { sent: false, reason: pushReady ? 'held_for_email' : 'expo_access_token_missing', count: 0 },
      inApp: 'toast_on_next_open',
      env: ['RESEND_API_KEY', 'RESEND_FROM', 'EXPO_ACCESS_TOKEN', 'CRON_SECRET'],
    }
  }

  const claimed = await store.claim(coupon.dropKey, coupon)
  if (!claimed) {
    return { ok: true, skipped: true, reason: 'already_dropped', coupon, inApp: 'toast_on_next_open' }
  }

  let emailed = 0
  let emailFailed = 0
  for (const person of recipients) {
    const message = fridayDropEmail({ coupon, firstName: person.full_name || person.fullName })
    try {
      await sendResendPromo({
        to: String(person.email).trim(),
        subject: message.subject,
        text: message.text,
        env,
        fetchImpl,
      })
      emailed += 1
    } catch {
      emailFailed += 1
    }
  }

  const push = await sendExpoPush({
    tokens,
    title: coupon.title,
    body: `${coupon.code} · ${coupon.detail}`,
    env,
    fetchImpl,
  })

  return {
    ok: true,
    skipped: false,
    coupon,
    recipients: recipients.length,
    emailed,
    emailFailed,
    push,
    inApp: 'toast_on_next_open',
  }
}
