/** Founding-partner application (/advertise/apply). Short on purpose: about six questions. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const s = (v, max) => String(v ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max)

export const APPLICATION_HONEYPOT = 'company_url'
export const APPLY_COPY = 'Apply to become a Founding Partner — limited spots'

export function normalizeApplication(b = {}) {
  return {
    businessName: s(b.businessName, 120),
    category: s(b.category, 80),
    address: s(b.address, 200),
    contactName: s(b.contactName, 120),
    email: s(b.email, 254).toLowerCase(),
    phone: s(b.phone, 32),
    website: s(b.website, 300),
    promote: s(b.promote, 500),
    offer: s(b.offer, 1000),
  }
}

export function applicationErrors(b = {}) {
  const v = normalizeApplication(b)
  const e = {}
  if (v.businessName.length < 2) e.businessName = 'Enter your business name.'
  if (!v.category) e.category = 'Pick a category.'
  if (v.address.length < 5) e.address = 'Enter your business address.'
  if (v.contactName.length < 2) e.contactName = 'Enter a contact name.'
  if (!EMAIL.test(v.email)) e.email = 'Enter a valid email.'
  if (v.phone) {
    const digits = v.phone.replace(/\D/g, '')
    if (digits.length < 10 || digits.length > 15) e.phone = 'Enter a phone number with area code.'
  }
  if (v.website && !/^https?:\/\/\S+\.\S{2,}$/i.test(v.website)) e.website = 'Use a full https:// link.'
  if (v.promote.length < 3) e.promote = 'Tell us what you would promote.'
  return e
}

export function applicationRow(b = {}) {
  const v = normalizeApplication(b)
  return {
    business_name: v.businessName,
    category: v.category || null,
    address: v.address,
    contact_name: v.contactName,
    email: v.email,
    phone: v.phone || null,
    website: v.website || null,
    promote: v.promote,
    offer: v.offer || null,
  }
}
