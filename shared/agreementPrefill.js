/**
 * Pre-filled particulars appended after the canonical IC agreement.
 * The canonical HTML stays byte-identical; only this section varies.
 */
import { IC_AGREEMENT_HTML, IC_AGREEMENT_VERSION } from './icAgreement.js'
import { TAX_CLASSIFICATIONS, WORK_ELIGIBILITY_CATEGORIES } from './driverOnboarding.js'

export { IC_AGREEMENT_VERSION }

const NOT_PROVIDED = 'Not provided'

const FIELD_ORDER = [
  ['legal_name', 'Legal name'],
  ['mailing_address', 'Mailing address'],
  ['phone', 'Phone'],
  ['email', 'Email'],
  ['vehicle_make', 'Vehicle make'],
  ['vehicle_model', 'Vehicle model'],
  ['vehicle_color', 'Vehicle color'],
  ['vehicle_plate', 'Vehicle plate'],
  ['vehicle_seats', 'Vehicle seats'],
  ['license', 'Driver license'],
  ['tax_classification', 'Tax classification'],
  ['business_name', 'Business name'],
  ['tin_last4', 'TIN last 4'],
  ['work_eligibility', 'Work eligibility'],
]

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function provided(value) {
  const cleaned = String(value ?? '').trim()
  return cleaned || NOT_PROVIDED
}

function choiceLabel(list, id) {
  const cleaned = String(id ?? '').trim()
  if (!cleaned) return NOT_PROVIDED
  return list.find((item) => item.id === cleaned)?.label || cleaned
}

function tinLast4(value) {
  const last4 = String(value ?? '').trim()
  if (!/^[0-9]{4}$/.test(last4)) return NOT_PROVIDED
  return last4
}

export function buildAgreementPrefill(input = {}) {
  const vehicle = input.vehicle || {}
  const seats = vehicle.seats == null || vehicle.seats === '' ? '' : String(vehicle.seats)
  return {
    legal_name: provided(input.legalName || input.fullName),
    mailing_address: provided(input.address),
    phone: provided(input.phone),
    email: provided(input.applicantEmail || input.email),
    vehicle_make: provided(vehicle.make),
    vehicle_model: provided(vehicle.model),
    vehicle_color: provided(vehicle.color),
    vehicle_plate: provided(vehicle.plate),
    vehicle_seats: provided(seats),
    license: input.licenseOnFile
      ? 'Driver license photos (front and back) on file'
      : NOT_PROVIDED,
    tax_classification: choiceLabel(TAX_CLASSIFICATIONS, input.taxClassification),
    business_name: provided(input.businessName),
    tin_last4: tinLast4(input.tinLast4),
    work_eligibility: choiceLabel(WORK_ELIGIBILITY_CATEGORIES, input.workEligibilityCategory),
  }
}

export function renderPrefilledAgreement(prefill = {}) {
  const rows = FIELD_ORDER.map(([key, label]) => {
    const value = escapeHtml(prefill[key] || NOT_PROVIDED)
    return `<tr><th>${escapeHtml(label)}</th><td>${value}</td></tr>`
  }).join('')
  const particulars = [
    '<section data-agreement-particulars>',
    '<h2>Driver particulars</h2>',
    '<p>These particulars are filled from the driver application. They are not a change to the agreement text above.</p>',
    `<table>${rows}</table>`,
    '</section>',
  ].join('')
  return `${IC_AGREEMENT_HTML}\n${particulars}`
}
