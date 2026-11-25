/**
 * Sends the auto-issued promo code emails queued in promo_email_outbox.
 *
 * Off unless PROMO_CODE_EMAILS_ENABLED=1. Uses the existing Resend sender
 * settings (RESEND_API_KEY, RESEND_FROM). Each row is leased by
 * promo_claim_email_batch (FOR UPDATE SKIP LOCKED) and posted with a Resend
 * Idempotency-Key of the outbox id, so a retry after a crash cannot send twice.
 * Runs from the minute job (/api/scheduled-dispatch-tick).
 */
import { resendPayload } from './resendMail.js'
import { promoAutoEmail } from '../shared/promoEmail.js'

const MAX_ATTEMPTS = 8
const UNCONFIRMED_RETRY_MS = 6 * 60 * 60 * 1000
const MAX_UNCONFIRMED_CHECKS = 60

function flagOn(value) {
  const v = String(value ?? '').trim().toLowerCase()
  return v === '1' || v === 'true'
}

export function promoEmailsEnabled(env = process.env) {
  return flagOn(env?.PROMO_CODE_EMAILS_ENABLED)
}

/** 5 min, 10, 20 … capped at 12 h. */
export function promoEmailBackoffMs(attempts) {
  const n = Math.max(1, Math.round(Number(attempts) || 1))
  return Math.min(12 * 60 * 60 * 1000, 5 * 60 * 1000 * 2 ** (n - 1))
}

function short(value) {
  return String(value || '').replace(/\s+/g, ' ').slice(0, 300)
}

async function mark(sb, id, patch, now) {
  await sb.from('promo_email_outbox').update({ ...patch, locked_until: null, updated_at: now.toISOString() }).eq('id', id)
}

async function recipientFor(sb, profileId) {
  const res = await sb.auth?.admin?.getUserById?.(profileId)
  const user = res?.data?.user
  if (!user) return { email: null, confirmed: false }
  return { email: user.email || null, confirmed: Boolean(user.email_confirmed_at || user.confirmed_at) }
}

async function postResend({ fetchImpl, key, payload, idempotencyKey }) {
  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) return { ok: false, error: `resend_${res.status}: ${short(body?.message || body?.name || 'not sent')}` }
  return { ok: true, id: body?.id || null }
}

/**
 * One pass over due outbox rows. Never throws for a single bad row.
 * deps.fetchImpl is required under the Node test runner, so a test can never
 * reach the real Resend API.
 */
export async function runPromoEmailOutbox({ sb, env = process.env, now = new Date(), fetchImpl, limit = 25, dryRun = false } = {}) {
  if (!promoEmailsEnabled(env)) return { ok: true, skipped: true, reason: 'flag_off' }
  if (dryRun) return { ok: true, skipped: true, reason: 'dry_run' }
  if (!fetchImpl && process.env.NODE_TEST_CONTEXT) return { ok: true, skipped: true, reason: 'test_env' }
  const key = String(env.RESEND_API_KEY || '').trim()
  const from = String(env.RESEND_FROM || '').trim()
  if (!key || key.includes('placeholder') || !from) return { ok: true, skipped: true, reason: 'resend_not_configured' }
  if (!sb?.rpc) return { ok: false, reason: 'no_database' }
  const send = fetchImpl || globalThis.fetch

  const leased = await sb.rpc('promo_claim_email_batch', { p_limit: limit })
  if (leased?.error) return { ok: false, reason: 'lease_failed', error: short(leased.error.message) }
  const summary = { ok: true, leased: 0, sent: 0, retry: 0, failed: 0, skipped: 0, waiting: 0 }
  for (const row of leased?.data || []) {
    summary.leased += 1
    try {
      const codeRes = await sb.from('promo_campaign_codes')
        .select('id, code, active, expires_at, percent_off_bps, max_discount_cents, owner_profile_id')
        .eq('id', row.code_id).maybeSingle()
      const code = codeRes?.data
      if (!code || !code.active || new Date(code.expires_at) <= now || code.owner_profile_id !== row.profile_id) {
        await mark(sb, row.id, { status: 'skipped', last_error: 'code_not_live' }, now)
        summary.skipped += 1
        continue
      }
      const who = await recipientFor(sb, row.profile_id)
      if (!who.email) {
        await mark(sb, row.id, { status: 'skipped', last_error: 'no_email' }, now)
        summary.skipped += 1
        continue
      }
      if (!who.confirmed) {
        // Do not mail an address nobody has confirmed. Check again later.
        const giveUp = row.attempts >= MAX_UNCONFIRMED_CHECKS
        await mark(sb, row.id, giveUp
          ? { status: 'skipped', last_error: 'email_unconfirmed' }
          : { status: 'pending', last_error: 'email_unconfirmed', next_attempt_at: new Date(now.getTime() + UNCONFIRMED_RETRY_MS).toISOString() }, now)
        summary[giveUp ? 'skipped' : 'waiting'] += 1
        continue
      }
      const message = promoAutoEmail({
        kind: row.kind, code: code.code, expiresAt: code.expires_at,
        percentOffBps: code.percent_off_bps, maxDiscountCents: code.max_discount_cents, env,
      })
      if (!message) {
        await mark(sb, row.id, { status: 'skipped', last_error: 'unknown_kind' }, now)
        summary.skipped += 1
        continue
      }
      const result = await postResend({
        fetchImpl: send,
        key,
        idempotencyKey: `promo-email-${row.id}`,
        payload: resendPayload({ from, to: who.email, subject: message.subject, text: message.text, html: message.html, env }),
      })
      if (result.ok) {
        await mark(sb, row.id, { status: 'sent', sent_at: now.toISOString(), provider_message_id: result.id, last_error: null }, now)
        summary.sent += 1
      } else if (row.attempts >= MAX_ATTEMPTS) {
        await mark(sb, row.id, { status: 'failed', last_error: result.error }, now)
        summary.failed += 1
      } else {
        await mark(sb, row.id, {
          status: 'pending', last_error: result.error,
          next_attempt_at: new Date(now.getTime() + promoEmailBackoffMs(row.attempts)).toISOString(),
        }, now)
        summary.retry += 1
      }
    } catch (err) {
      // Lease expires and the row is picked up again; same idempotency key.
      console.error('[promo-email]', short(err?.message || err))
      summary.retry += 1
      try {
        await mark(sb, row.id, {
          status: row.attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          last_error: short(err?.message || 'send_error'),
          next_attempt_at: new Date(now.getTime() + promoEmailBackoffMs(row.attempts)).toISOString(),
        }, now)
      } catch {
        /* lease expiry retries it */
      }
    }
  }
  return summary
}
