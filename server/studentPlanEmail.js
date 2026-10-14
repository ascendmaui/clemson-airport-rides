/**
 * Personalized plan email (Resend). PREVIEW / DRY-RUN ONLY: sending stays off
 * until STUDENT_PLAN_EMAILS_SEND=1 AND STUDENT_PLANS_ENABLED=1. Every email
 * carries an unsubscribe link and the business address (CAN-SPAM).
 */
import { supportEmail } from '../shared/productLinks.js'
import { BUSINESS_ADDRESS, PATTERN_COPY, PRODUCT_NAME, WEEKEND_CARPOOL_PLAN, formatUsd } from '../shared/studentPlans.js'

export function planEmailFrom(env = {}) {
  return `Clemson Rides <${supportEmail(env)}>`
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

export function siteOrigin(env = {}) {
  return String(env.PUBLIC_SITE_URL || 'https://clemsonrides.com').replace(/\/+$/, '')
}

export function unsubscribeUrl(token, env = {}) {
  return `${siteOrigin(env)}/api/stripe-payment-methods?action=student-plans&op=unsubscribe&token=${encodeURIComponent(token)}`
}

export function planDeepLink(quoteId) {
  return `clemsonrides://student-plans?quote=${encodeURIComponent(quoteId || '')}`
}

/** Builds subject / text / html. Never sends. */
export function renderPlanEmail({ firstName, metrics, quote, summary, quoteId, unsubscribeToken, env = {} }) {
  const name = firstName || 'there'
  const unsub = unsubscribeUrl(unsubscribeToken || '', env)
  const link = planDeepLink(quoteId)
  const spentLine = quote.planId
    ? `You would have spent ${formatUsd(quote.retailMonthlyCents)}, your plan is ${formatUsd(quote.monthlyCents)}.`
    : `Tiger Pass is your best value right now.`
  const subject = quote.planId
    ? `Save ${formatUsd(quote.savingsCents)} a month on ${PRODUCT_NAME}`
    : `Your ${PRODUCT_NAME} ride summary`
  const extra = quote.planId
    ? [
      `Semester prepay: ${formatUsd(quote.semesterCents)} (15% off).`,
      `Best value: 4 years for ${formatUsd(WEEKEND_CARPOOL_PLAN.fourYearAnchorCents)}.`,
      `Quote valid until ${new Date(quote.expiresAt).toLocaleDateString('en-US', { timeZone: 'America/New_York' })}. Price locked for your first ${quote.priceLockMonths} billing months.`,
    ]
    : []
  const text = [
    `Hi ${name},`,
    '',
    summary,
    '',
    spentLine,
    ...extra,
    '',
    quote.planId ? `Open your plan: ${link}` : `See Tiger Pass in the app: clemsonrides://tiger-pass`,
    '',
    '—',
    PRODUCT_NAME,
    BUSINESS_ADDRESS,
    `Unsubscribe: ${unsub}`,
  ].join('\n')
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#1d1d1f;max-width:560px;margin:0 auto;padding:24px">
<p style="color:#F56600;font-weight:800;letter-spacing:1px;font-size:12px">${esc(PRODUCT_NAME.toUpperCase())} · STUDENT PLAN</p>
<p>Hi ${esc(name)},</p>
<p>${esc(summary)}</p>
<p style="font-size:20px;font-weight:800">${esc(spentLine)}</p>
${quote.planId ? `<p style="font-size:16px">That's <strong>${esc(formatUsd(quote.savingsCents))}</strong> back in your pocket every month.</p>` : ''}
${extra.map((l) => `<p style="color:#555;font-size:14px">${esc(l)}</p>`).join('\n')}
<p><a href="${esc(quote.planId ? link : 'clemsonrides://tiger-pass')}" style="display:inline-block;background:#F56600;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700">${quote.planId ? 'Subscribe' : 'See Tiger Pass'}</a></p>
<hr style="border:none;border-top:1px solid #eee;margin:24px 0">
<p style="color:#777;font-size:12px">${esc(PRODUCT_NAME)} · ${esc(BUSINESS_ADDRESS)}<br>
You're getting this because you ride with ${esc(PRODUCT_NAME)} using a verified clemson.edu email. <a href="${esc(unsub)}">Unsubscribe</a>.</p>
</body></html>`
  return {
    from: planEmailFrom(env),
    subject,
    text,
    html,
    headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    pattern: PATTERN_COPY[metrics?.pattern] || null,
  }
}
