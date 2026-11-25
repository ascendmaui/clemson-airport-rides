/** Shared Resend JSON body. From stays whatever the caller already uses. */
import { supportEmail } from '../shared/productLinks.js'

export function resendPayload({ from, to, subject, text, html, env } = {}) {
  const recipients = (Array.isArray(to) ? to : [to])
    .map((value) => String(value || '').trim())
    .filter(Boolean)
  const payload = {
    from,
    to: recipients,
    subject,
    text,
    reply_to: supportEmail(env),
  }
  if (html) payload.html = html
  return payload
}
