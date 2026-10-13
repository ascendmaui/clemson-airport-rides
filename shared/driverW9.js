/**
 * Driver W-9 form checks and the public shape sent back to the app.
 * The full TIN is never part of that shape. Last four only.
 */
import { TAX_CLASSIFICATIONS, displayTinLast4 } from './driverOnboarding.js'

export const W9_PUBLIC_COLUMNS = [
  'profile_id',
  'legal_name',
  'business_name',
  'tax_classification',
  'address_line',
  'tin_last4',
  'tin_kind',
  'certified',
  'signature_name',
  'signed_on',
  'collection',
  'created_at',
  'updated_at',
].join(', ')

export function tinDigits(value) {
  return String(value ?? '').replace(/\D/g, '')
}

/**
 * SSN: AAA-GG-SSSS, area not 000, 666, or 900–999, group not 00, serial not 0000.
 * EIN: XX-XXXXXXX, prefix not 00, serial not 0000000.
 */
export function tinFormatIssue(value, kind) {
  const digits = tinDigits(value)
  if (!/^\d{9}$/.test(digits)) return 'Enter a 9-digit SSN or EIN.'
  if (kind === 'ssn') {
    const area = Number(digits.slice(0, 3))
    const group = digits.slice(3, 5)
    const serial = digits.slice(5)
    if (area === 0 || area === 666 || area >= 900 || group === '00' || serial === '0000') {
      return 'Enter a valid SSN.'
    }
    return null
  }
  if (kind === 'ein') {
    if (digits.slice(0, 2) === '00' || digits.slice(2) === '0000000') return 'Enter a valid EIN.'
    return null
  }
  return 'Choose SSN or EIN.'
}

export function w9FormIssue(input = {}) {
  if (String(input.legalName || '').trim().length < 2) return 'Enter your legal name.'
  if (String(input.businessName || '').trim().length > 200) return 'Business name is too long.'
  if (!TAX_CLASSIFICATIONS.some((item) => item.id === input.taxClassification)) {
    return 'Select a federal tax classification.'
  }
  if (String(input.address || '').trim().length < 5) return 'Enter your address.'
  const tinIssue = tinFormatIssue(input.tin, input.tinKind)
  if (tinIssue) return tinIssue
  if (input.certified !== true) return 'Certification is required before you can sign.'
  if (String(input.signatureName || '').trim().length < 2) return 'Type your legal name to sign.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.signedOn || ''))) return 'Enter the date as YYYY-MM-DD.'
  return null
}

function cleanText(value) {
  const text = String(value ?? '').trim()
  return text || null
}

/** Drop every secret field. A full TIN stored in tin_last4 is blanked. */
export function toPublicW9(row) {
  if (!row || typeof row !== 'object') return null
  const last4raw = String(row.tin_last4 ?? row.tinLast4 ?? '')
  const tinLast4 = /^[0-9]{4}$/.test(last4raw) ? last4raw : null
  const kind = row.tin_kind ?? row.tinKind
  const collection = row.collection === 'stripe' ? 'stripe' : 'app'
  return {
    legalName: cleanText(row.legal_name ?? row.legalName),
    businessName: cleanText(row.business_name ?? row.businessName),
    taxClassification: cleanText(row.tax_classification ?? row.taxClassification),
    address: cleanText(row.address_line ?? row.address),
    tinLast4,
    tinKind: kind === 'ssn' || kind === 'ein' ? kind : null,
    certified: row.certified === true,
    signatureName: cleanText(row.signature_name ?? row.signatureName),
    signedOn: cleanText(row.signed_on ?? row.signedOn),
    collection,
    updatedAt: cleanText(row.updated_at ?? row.updatedAt),
  }
}

export function w9StatusLabel(desk) {
  const status = desk?.status || null
  if (desk?.stripeConnect) {
    if (desk.stripeDetailsSubmitted) return 'On file with Stripe. The tax id stays on Stripe, not in this app.'
    return 'Finish tax info in Stripe. The tax id stays on Stripe, not in this app.'
  }
  if (status?.certified && status.tinLast4) {
    const when = status.signedOn ? ` Signed ${status.signedOn}.` : ''
    return `On file · ${displayTinLast4(status.tinLast4)}.${when}`
  }
  if (status?.tinLast4) return `Last four ${displayTinLast4(status.tinLast4)}. Certification is still needed.`
  return 'Not on file'
}

export function responseContainsTin(payload, tin) {
  const digits = tinDigits(tin)
  if (digits.length < 9) return false
  return JSON.stringify(payload ?? null).includes(digits)
}
