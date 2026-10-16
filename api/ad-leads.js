/**
 * /advertise interest form.
 *   POST /api/ad-leads   { businessName, contactName, email, phone, category, tier, message, website }
 * `website` is a honeypot: a filled value gets a quiet 200 and nothing is stored.
 * Light per-IP rate limit (agentHttp.rateLimit). Insert uses the service role;
 * the table's RLS also allows anonymous insert and admin-only select.
 * Admin email is best-effort through the existing Resend helper (ADMIN_NOTIFY_EMAIL).
 */
import { cors, json, parseBody, rateLimit } from '../server/agentHttp.js'
import { admin } from '../server/friendRideLib.js'
import { sendApplicantNotice } from '../server/applicantMail.js'
import { adminNotifyRecipients } from '../server/adminRoster.js'
import { WEB_ORIGIN, supportEmail } from '../shared/productLinks.js'
import { adLeadEmail, adLeadErrors, adLeadRow, isAdLeadBot } from '../shared/adLeads.js'

export const AD_LEAD_RATE = { bucket: 'ad-lead', limit: 5, windowMs: 10 * 60_000 }

export function createAdLeadsHandler({
  db = () => admin(),
  send = sendApplicantNotice,
  recipients = () => adminNotifyRecipients(),
  limit = (req) => rateLimit(req, AD_LEAD_RATE),
} = {}) {
  return async function adLeadsHandler(req, res) {
    if (cors(req, res)) return
    if (req.method !== 'POST') return json(res, 405, { error: 'Use POST' })
    const parsed = parseBody(req)
    if (parsed.error) return json(res, 400, { error: parsed.error })
    const body = parsed.body || {}
    if (isAdLeadBot(body)) return json(res, 200, { ok: true })
    if (!limit(req)) return json(res, 429, { error: 'Too many requests. Try again in a few minutes.' })
    const errors = adLeadErrors(body)
    if (Object.keys(errors).length) return json(res, 400, { error: 'Fix the highlighted fields.', errors })
    const sb = db()
    if (!sb) return json(res, 503, { error: `Sign-ups are offline right now. Email ${supportEmail()}.` })
    const row = adLeadRow(body, { userAgent: req.headers?.['user-agent'] })
    const { data, error } = await sb.from('ad_partner_leads').insert(row).select('id').single()
    if (error) {
      console.error('[ad-leads] insert', error.message || error)
      return json(res, 500, { error: `Could not save that. Try again or email ${supportEmail()}.` })
    }
    let notified = false
    try {
      const msg = adLeadEmail(row, WEB_ORIGIN)
      for (const to of recipients() || []) {
        const out = await send({ to, ...msg })
        notified = notified || Boolean(out?.emailed)
      }
    } catch (err) {
      console.error('[ad-leads] notify', err?.message || err)
    }
    return json(res, 200, { ok: true, id: data?.id || null, notified })
  }
}

export default createAdLeadsHandler()
