/**
 * Auto-issued promo code email (transactional). Copy and markup only; sending
 * is server/promoEmailOutbox.js through the existing Resend sender.
 */
import { supportEmail } from './productLinks.js'

export const PROMO_EMAIL_BRAND = Object.freeze({
  name: 'Clemson Rides',
  orange: '#F56600',
  purple: '#522D80',
  address: '101 North Main Street, Greenville, SC 29601',
})

const INTRO = {
  auto_signup: 'Welcome to Clemson Rides. Here is a code for your next ride.',
  auto_card: 'Thanks for adding a card to Clemson Rides. Here is a code for your next ride.',
  auto_credit50: 'Your Clemson Rides credit balance reached $50. Here is a code for your next ride.',
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
}

function usd(cents) {
  const n = Math.max(0, Math.round(Number(cents) || 0))
  return `$${(n / 100).toFixed(2).replace(/\.00$/, '')}`
}

/** Expiry in the rider's zone (Clemson is Eastern). */
export function promoExpiryLabel(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' })
}

export function promoEmailTerms({ percentOffBps = 5000, maxDiscountCents = null } = {}) {
  const pct = Math.round(Number(percentOffBps) / 100)
  return [
    `${pct}% off the fare of one ride${maxDiscountCents ? `, up to ${usd(maxDiscountCents)} off` : ''}. Single use.`,
    'Tied to your account. It cannot be shared or transferred.',
    'It applies to your next ride on its own, or enter the code when you book.',
    'One promo per ride. It does not combine with student or Tiger Pass pricing; you get the better price.',
    'Applies to the fare only, not tips, tip boosts or wait fees.',
    'If the ride is cancelled, the code goes back to your account.',
    'No cash value.',
  ]
}

/**
 * kind: auto_signup | auto_card | auto_credit50.
 * Returns { subject, text, html } or null for an unknown kind.
 */
export function promoAutoEmail({ kind, code, expiresAt, percentOffBps = 5000, maxDiscountCents = null, env } = {}) {
  if (!INTRO[kind] || !code) return null
  const pct = Math.round(Number(percentOffBps) / 100)
  const headline = `${pct}% off your next ride.`
  const expires = promoExpiryLabel(expiresAt)
  const terms = promoEmailTerms({ percentOffBps, maxDiscountCents })
  const support = supportEmail(env)
  const footer = `${PROMO_EMAIL_BRAND.name} · ${PROMO_EMAIL_BRAND.address}. This is a transactional message about your Clemson Rides account.`
  const subject = `${headline.replace(/\.$/, '')} | ${PROMO_EMAIL_BRAND.name}`
  const text = [
    INTRO[kind],
    '',
    headline,
    `Code: ${code}`,
    expires ? `Expires: ${expires}` : null,
    '',
    'Terms',
    ...terms.map((t) => `- ${t}`),
    '',
    `Questions: ${support}`,
    '',
    footer,
  ].filter((line) => line !== null).join('\n')

  const { orange, purple } = PROMO_EMAIL_BRAND
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f4f9;font-family:Helvetica,Arial,sans-serif;color:#1d1d1f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f4f9;padding:24px 0">
<tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden">
<tr><td style="background:${purple};padding:20px 28px;color:#ffffff;font-size:20px;font-weight:700">${escapeHtml(PROMO_EMAIL_BRAND.name)}</td></tr>
<tr><td style="padding:28px">
<p style="margin:0 0 12px;font-size:15px">${escapeHtml(INTRO[kind])}</p>
<p style="margin:0 0 20px;font-size:26px;font-weight:800;color:${purple}">${escapeHtml(headline)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px"><tr>
<td style="border:2px dashed ${orange};border-radius:10px;padding:14px 22px;font-size:24px;font-weight:800;letter-spacing:3px;color:${orange}">${escapeHtml(code)}</td>
</tr></table>
${expires ? `<p style="margin:0 0 20px;font-size:14px;color:#555">Expires ${escapeHtml(expires)}</p>` : ''}
<p style="margin:0 0 6px;font-size:13px;font-weight:700;color:${purple}">Terms</p>
<ul style="margin:0 0 20px;padding-left:18px;font-size:12px;line-height:1.5;color:#555">
${terms.map((t) => `<li>${escapeHtml(t)}</li>`).join('\n')}
</ul>
<p style="margin:0;font-size:12px;color:#555">Questions: <a href="mailto:${escapeHtml(support)}" style="color:${purple}">${escapeHtml(support)}</a></p>
</td></tr>
<tr><td style="background:${orange};height:4px;line-height:4px;font-size:0">&nbsp;</td></tr>
<tr><td style="padding:16px 28px;font-size:11px;color:#777">${escapeHtml(footer)}</td></tr>
</table>
</td></tr></table>
</body></html>`
  return { subject, text, html }
}
