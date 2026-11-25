/**
 * Ads autopilot (cron). Everything is OFF until John approves:
 *   ADS_AUTOMATION_ENABLED=true    writes (pause unpaid campaigns, mark notices sent)
 *   ADS_PARTNER_EMAILS_ENABLED=true sends partner email (reminders, ending notices, monthly report)
 * With both off the cron returns the plan only (what it would do) and sends nothing.
 */
const DAY = 86_400_000
export const REMINDER_EVERY_DAYS = 3
export const PAUSE_UNPAID_AFTER_DAYS = 14
export const ENDING_NOTICE_DAYS = 3

const on = (v) => String(v || '').trim().toLowerCase() === 'true'
export function automationFlags(env = process.env) {
  return { writes: on(env.ADS_AUTOMATION_ENABLED), emails: on(env.ADS_PARTNER_EMAILS_ENABLED) }
}

const t = (v) => (v ? Date.parse(v) : NaN)
export const monthKey = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
function prevMonth(now) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  return monthKey(d)
}

/** Pure planner: which reminders, pauses, ending notices and reports are due. */
export function planAdsAutomation(campaigns = [], now = new Date()) {
  const n = now.getTime()
  const plan = []
  for (const c of campaigns) {
    const email = c.ad_partners?.email || null
    if (c.status === 'pending_payment' && c.payment_url) {
      const since = t(c.updated_at) || t(c.created_at)
      if (Number.isFinite(since) && n - since >= PAUSE_UNPAID_AFTER_DAYS * DAY) {
        plan.push({ kind: 'pause_unpaid', campaignId: c.id, email })
        continue
      }
      const last = t(c.last_reminder_at)
      if (!Number.isFinite(last) || n - last >= REMINDER_EVERY_DAYS * DAY) plan.push({ kind: 'invoice_reminder', campaignId: c.id, email })
    }
    if (c.status === 'active') {
      const end = t(c.ends_at)
      if (Number.isFinite(end) && end > n && end - n <= ENDING_NOTICE_DAYS * DAY && !c.ending_notice_at) {
        plan.push({ kind: 'ending_notice', campaignId: c.id, email })
      }
      if (now.getUTCDate() === 1 && c.last_report_month !== prevMonth(now)) {
        plan.push({ kind: 'monthly_report', campaignId: c.id, email, month: prevMonth(now) })
      }
    }
  }
  return plan
}

export function partnerEmail(step, c, stats = {}) {
  const biz = c.ad_partners?.business_name || 'there'
  switch (step.kind) {
    case 'invoice_reminder':
      return { subject: 'Your Clemson Rides ad campaign is waiting on payment', text: `Hi ${biz}, your in-car tablet campaign starts once the invoice is paid: ${c.payment_url}` }
    case 'pause_unpaid':
      return { subject: 'Your Clemson Rides ad campaign is paused', text: `Hi ${biz}, we paused your campaign because the invoice is still unpaid. Reply to restart it.` }
    case 'ending_notice':
      return { subject: 'Your Clemson Rides ad campaign ends soon', text: `Hi ${biz}, your campaign ends ${new Date(c.ends_at).toDateString()}. Reply to renew.` }
    case 'monthly_report':
      return { subject: `Your Clemson Rides ad report for ${step.month}`, text: `Hi ${biz}, last month your ad was shown ${stats.impressions || 0} times for ${Math.round((stats.seconds || 0) / 60)} minutes across Clemson Rides cars. Rides served so far: ${c.rides_served || 0}${c.rides_purchased ? ` of ${c.rides_purchased}` : ''}.` }
    default:
      return null
  }
}

export async function runAdsAutomation({ sb, env = process.env, now = new Date(), send, stats = async () => ({}) }) {
  const flags = automationFlags(env)
  const { data, error } = await sb.from('ad_campaigns').select('*, ad_partners(business_name, email)').in('status', ['pending_payment', 'active'])
  if (error) return { ok: false, error: error.message }
  const plan = planAdsAutomation(data || [], now)
  const byId = new Map((data || []).map((c) => [c.id, c]))
  const done = []
  for (const step of plan) {
    const c = byId.get(step.campaignId)
    const result = { ...step, wrote: false, emailed: false }
    if (flags.writes) {
      const patch = { updated_at: now.toISOString() }
      if (step.kind === 'pause_unpaid') Object.assign(patch, { status: 'paused', ended_reason: 'unpaid' })
      if (step.kind === 'invoice_reminder') { patch.last_reminder_at = now.toISOString(); delete patch.updated_at }
      if (step.kind === 'ending_notice') patch.ending_notice_at = now.toISOString()
      if (step.kind === 'monthly_report') patch.last_report_month = step.month
      await sb.from('ad_campaigns').update(patch).eq('id', c.id)
      result.wrote = true
    }
    if (flags.emails && flags.writes && step.email && typeof send === 'function') {
      const msg = partnerEmail(step, c, step.kind === 'monthly_report' ? await stats(c, step.month) : {})
      if (msg) result.emailed = Boolean((await send({ to: step.email, ...msg }))?.emailed)
    }
    done.push(result)
  }
  return { ok: true, flags, dryRun: !flags.writes, plan: done }
}
