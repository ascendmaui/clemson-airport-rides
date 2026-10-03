import { APPLICANT_FROM_ADDRESS } from '../shared/applicantEmail.js'

export { APPLICANT_FROM_ADDRESS }

/**
 * From address for driver-application Resend mail.
 * A vercel.app host, a placeholder, or any other domain is replaced with applications@clemsonrides.com.
 */
export function resolveApplicantFromAddress(raw = process.env.RESEND_FROM) {
  const from = String(raw || '').trim()
  if (!from) return APPLICANT_FROM_ADDRESS
  const lower = from.toLowerCase()
  if (
    lower.includes('vercel.app')
    || lower.includes('placeholder')
    || lower.includes('example.com')
    || lower.includes('resend.dev')
  ) {
    return APPLICANT_FROM_ADDRESS
  }
  const match = lower.match(/[a-z0-9._%+-]+@([a-z0-9.-]+)/)
  if (!match || match[1] !== 'clemsonrides.com') return APPLICANT_FROM_ADDRESS
  return from
}
