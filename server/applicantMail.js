/** Best-effort applicant email. Without Resend, the driver app still shows the message. */
import { resendPayload } from './resendMail.js'
import { clientErrorMessage } from './clientError.js'

export async function sendApplicantNotice({ to, subject, text, env = process.env }) {
  const key = (env.RESEND_API_KEY || '').trim()
  const from = (env.RESEND_FROM || '').trim()
  const stub = String(text || '')
  if (!to) return { emailed: false, stub, todo: 'Applicant has no email on the profile.' }
  if (!key || key.includes('placeholder') || !from) {
    return {
      emailed: false,
      stub,
      todo: 'Set RESEND_API_KEY and RESEND_FROM to email applicants. The message is in the driver application.',
    }
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(resendPayload({ from, to, subject, text: stub, env })),
      signal: AbortSignal.timeout(8000),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      return {
        emailed: false,
        stub,
        todo: `Resend failed (${res.status}): ${body.message || body.error || 'email not sent'}. The message is in the driver application.`,
      }
    }
    return { emailed: true, id: body.id || null, stub: null, todo: null }
  } catch (err) {
    return {
      emailed: false,
      stub,
        todo: `Resend request failed: ${clientErrorMessage(err, 'email not sent')}. The message is in the driver application.`,
    }
  }
}
