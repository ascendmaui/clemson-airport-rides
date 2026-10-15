/**
 * Nightly personalized-quote job. For each rider with a verified clemson.edu
 * email who has 5+ completed, paid rides (and 14+ days of history), compute a
 * rules-based quote and store it in plan_quotes with an email PREVIEW.
 * Email sending is disabled: rows are written with email_status 'preview'.
 */
import { generateText } from 'ai'
import {
  QUOTE_LOOKBACK_DAYS, QUOTE_PRICE_LOCK_MONTHS, QUOTE_TRIGGER_RIDES,
  analyzeRides, buildQuote, fallbackSummary, isClemsonStudentEmail, quoteEligible,
  studentPlanEmailSendingEnabled,
} from '../shared/studentPlans.js'
import { renderPlanEmail } from './studentPlanEmail.js'

const TRIP_COLS = 'id, rider_id, status, payment_status, tier, fare_cents, surge_multiplier, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, completed_at, pickup_at, requested_at, created_at, fare_breakdown, metadata'

/** AI writes only the friendly sentence; numbers come from the rules. */
export async function aiSummary(metrics, quote, deps = {}) {
  const fallback = fallbackSummary(metrics, quote)
  const resolve = deps.resolveLanguageModel
  if (!resolve) return fallback
  try {
    const resolved = await resolve()
    if (!resolved?.model) return fallback
    const gen = deps.generateText || generateText
    const { text } = await gen({
      model: resolved.model,
      maxOutputTokens: 80,
      prompt: `Rewrite this as one friendly sentence for a Clemson student. Keep every number exactly as written, add no new numbers, no emojis:\n${fallback}`,
    })
    const out = String(text || '').trim().replace(/\s+/g, ' ')
    const nums = (s) => (s.match(/\$?\d[\d,.]*/g) || []).map((x) => x.replace(/[$,]/g, '').replace(/\.$/, ''))
    const want = nums(fallback)
    if (!out || out.length > 280 || !want.every((n) => nums(out).includes(n))) return fallback
    return out
  } catch {
    return fallback
  }
}

function rowsOf(result) {
  if (result?.error) throw new Error(result.error.message)
  return result?.data || []
}

export async function runNightlyQuotes(sb, { now = new Date(), env = process.env, dryRun = true, limit = 500, deps = {} } = {}) {
  const sending = !dryRun && studentPlanEmailSendingEnabled(env)
  const since = new Date(now.getTime() - 365 * 86400000).toISOString()
  const completed = rowsOf(await sb.from('trips').select('rider_id').eq('status', 'completed').eq('payment_status', 'paid').gte('completed_at', since).limit(20000))
  const counts = new Map()
  for (const r of completed) if (r.rider_id) counts.set(r.rider_id, (counts.get(r.rider_id) || 0) + 1)
  const candidates = [...counts.entries()].filter(([, c]) => c >= QUOTE_TRIGGER_RIDES).map(([id]) => id).slice(0, limit)
  const summary = { candidates: candidates.length, written: 0, skipped: {}, previews: [], sending, dryRun }
  if (!candidates.length) return summary

  const profiles = rowsOf(await sb.from('profiles').select('id, email, full_name, student_verified_at').in('id', candidates))
  const quoted = new Set(rowsOf(await sb.from('plan_quotes').select('rider_id').in('rider_id', candidates)).map((r) => r.rider_id))
  const optouts = new Set(rowsOf(await sb.from('student_plan_email_optouts').select('rider_id').in('rider_id', candidates)).map((r) => r.rider_id))
  const subs = new Set(rowsOf(await sb.from('student_plan_subscriptions').select('rider_id, status').in('rider_id', candidates))
    .filter((r) => r.status !== 'canceled').map((r) => r.rider_id))

  const skip = (reason) => { summary.skipped[reason] = (summary.skipped[reason] || 0) + 1 }
  for (const p of profiles) {
    const verifiedStudent = Boolean(p.student_verified_at) && isClemsonStudentEmail(p.email)
    if (!verifiedStudent) { skip('not_verified_student'); continue }
    const trips = rowsOf(await sb.from('trips').select(TRIP_COLS).eq('rider_id', p.id).eq('status', 'completed').order('completed_at', { ascending: true }).limit(1000))
    const metrics = analyzeRides(trips, { now })
    const ok = quoteEligible({ metrics, verifiedStudent, hasPlan: subs.has(p.id), optedOut: optouts.has(p.id), alreadyQuoted: quoted.has(p.id) })
    if (!ok.ok) { skip(ok.reason); continue }
    const quote = buildQuote(metrics, { now })
    const text = await aiSummary(metrics, quote, deps)
    const row = {
      rider_id: p.id,
      pattern: metrics.pattern,
      metrics: { ...metrics, lookbackDays: QUOTE_LOOKBACK_DAYS },
      quoted_plan: quote.planId,
      recommendation: quote.recommendation,
      monthly_cents: quote.monthlyCents,
      semester_cents: quote.semesterCents,
      retail_monthly_cents: quote.retailMonthlyCents,
      floor_cents: quote.floorCents,
      savings_cents: quote.savingsCents,
      summary: text,
      email_status: 'preview',
      expires_at: quote.expiresAt,
      price_locked_until: new Date(now.getTime() + QUOTE_PRICE_LOCK_MONTHS * 31 * 86400000).toISOString(),
    }
    if (dryRun) {
      const preview = renderPlanEmail({ firstName: (p.full_name || '').split(' ')[0], metrics, quote, summary: text, quoteId: 'preview', unsubscribeToken: 'preview', env })
      summary.previews.push({ riderId: p.id, quote, subject: preview.subject, text: preview.text })
      continue
    }
    const ins = await sb.from('plan_quotes').insert(row).select('id, unsubscribe_token').maybeSingle()
    if (ins.error) {
      if (String(ins.error.code) === '23505') { skip('already_quoted'); continue }
      throw new Error(ins.error.message)
    }
    const preview = renderPlanEmail({ firstName: (p.full_name || '').split(' ')[0], metrics, quote, summary: text, quoteId: ins.data?.id, unsubscribeToken: ins.data?.unsubscribe_token, env })
    await sb.from('plan_quotes').update({ email_preview: { subject: preview.subject, text: preview.text, html: preview.html } }).eq('id', ins.data?.id)
    // Sending is intentionally not implemented while disabled; a future change
    // can hand `preview` to Resend when studentPlanEmailSendingEnabled(env).
    summary.written += 1
  }
  return summary
}
