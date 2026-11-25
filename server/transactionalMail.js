/**
 * Transactional mail through sendApplicantNotice (the existing Resend sender).
 * Driver approval and decline are sent from the admin review action.
 * Ride confirmation, receipt, cancellation, and payout notice have copy and a
 * sender here. Their product flows are not hooked up yet: each has more than
 * one writer, and a retry must not send the same notice twice.
 */
import { transactionalEmail } from '../shared/transactionalEmail.js'
import { sendApplicantNotice } from './applicantMail.js'

export async function sendTransactionalEmail({ kind, to, ctx, env, send } = {}) {
  const message = transactionalEmail(kind, ctx, env)
  if (!message) return { emailed: false, reason: 'unknown_kind' }
  const deliver = send || ((payload) => sendApplicantNotice(payload))
  try {
    const result = await deliver({
      to,
      subject: message.subject,
      text: message.text,
      env: env || process.env,
    })
    return result || { emailed: false }
  } catch (err) {
    return { emailed: false, reason: err?.message || 'email_failed' }
  }
}

/** Best-effort. A mail failure does not undo the approval decision. */
export async function emailDriverDecision({ to, decision, reason, name, send } = {}) {
  const kind = decision === 'approve' ? 'driver_approved' : decision === 'reject' ? 'driver_declined' : ''
  if (!kind) return { emailed: false, reason: 'unknown_decision' }
  return sendTransactionalEmail({ kind, to, ctx: { name, reason }, send })
}
