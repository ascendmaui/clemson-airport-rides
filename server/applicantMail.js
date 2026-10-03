/**
 * Best-effort applicant email through Resend.
 * The from-address is applications@clemsonrides.com unless RESEND_FROM is set.
 * A missing or unverified DNS record does not skip the send when RESEND_API_KEY is set.
 * Without a key, the driver app still shows the message. No key is stored in the repo.
 */

export const DEFAULT_APPLICANT_FROM = 'Clemson RIDES <applications@clemsonrides.com>'

export function resolveApplicantFrom(env = process.env) {
  const configured = String(env.RESEND_FROM || '').trim()
  return configured || DEFAULT_APPLICANT_FROM
}

function recipientList(to) {
  const raw = Array.isArray(to) ? to : [to]
  return raw.map((item) => String(item || '').trim()).filter(Boolean)
}

export async function sendApplicantNotice({ to, subject, text, html } = {}, env = process.env) {
  const key = String(env.RESEND_API_KEY || '').trim()
  const from = resolveApplicantFrom(env)
  const stub = String(text || '')
  const recipients = recipientList(to)
  if (!recipients.length) {
    return { emailed: false, stub, todo: 'Applicant has no email on the profile.', from }
  }
  if (!key || key.includes('placeholder')) {
    return {
      emailed: false,
      stub,
      todo: 'Set RESEND_API_KEY to email applicants from applications@clemsonrides.com. The message is in the driver application.',
      from,
    }
  }

  try {
    const payload = {
      from,
      to: recipients,
      subject,
      text: stub,
    }
    if (html) payload.html = html
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      return {
        emailed: false,
        stub,
        todo: `Resend failed (${res.status}): ${body.message || body.error || 'email not sent'}. The message is in the driver application.`,
        from,
      }
    }
    return { emailed: true, id: body.id || null, stub: null, todo: null, from }
  } catch (err) {
    return {
      emailed: false,
      stub,
      todo: `Resend request failed: ${err.message || err}. The message is in the driver application.`,
      from,
    }
  }
}
