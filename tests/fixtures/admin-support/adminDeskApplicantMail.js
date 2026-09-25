/**
 * Test double for server/applicantMail.js.
 * Records the notice and never calls Resend or fetch.
 */

export const state = {
  calls: [],
}

export async function sendApplicantNotice({ to, subject, text } = {}) {
  const stub = String(text || '')
  const todo = 'email suppressed in tests'
  state.calls.push({ to, subject, text: stub, emailed: false, stub, todo })
  return { emailed: false, stub, todo }
}
