/** Shared rules for the /advertise interest form (web client and api/ad-leads.js). */

export const AD_LEAD_HONEYPOT = 'website'
export const AD_LEAD_LIMITS = {
  businessName: 120,
  contactName: 120,
  email: 254,
  phone: 32,
  category: 80,
  tier: 80,
  message: 2000,
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)

/** Trimmed, length-capped copy of the submitted fields. */
export function normalizeAdLead(input = {}) {
  const message = String(input.message ?? '').replace(/\u0000/g, '').trim().slice(0, AD_LEAD_LIMITS.message)
  return {
    businessName: clean(input.businessName, AD_LEAD_LIMITS.businessName),
    contactName: clean(input.contactName, AD_LEAD_LIMITS.contactName),
    email: clean(input.email, AD_LEAD_LIMITS.email).toLowerCase(),
    phone: clean(input.phone, AD_LEAD_LIMITS.phone),
    category: clean(input.category, AD_LEAD_LIMITS.category),
    tier: clean(input.tier, AD_LEAD_LIMITS.tier),
    message,
  }
}

/** Field errors keyed by field name. Empty object means valid. */
export function adLeadErrors(input = {}) {
  const lead = normalizeAdLead(input)
  const errors = {}
  if (lead.businessName.length < 2) errors.businessName = 'Enter your business name.'
  if (lead.contactName.length < 2) errors.contactName = 'Enter a contact name.'
  if (!EMAIL.test(lead.email)) errors.email = 'Enter a valid email.'
  const digits = lead.phone.replace(/\D/g, '')
  if (digits.length < 10 || digits.length > 15) errors.phone = 'Enter a phone number with area code.'
  if (!lead.category) errors.category = 'Pick a category.'
  return errors
}

/** True when the hidden honeypot field was filled (bots fill every input). */
export function isAdLeadBot(input = {}) {
  return String(input?.[AD_LEAD_HONEYPOT] ?? '').trim().length > 0
}

/** Row for public.ad_partner_leads. */
export function adLeadRow(input = {}, { userAgent = '' } = {}) {
  const lead = normalizeAdLead(input)
  return {
    business_name: lead.businessName,
    contact_name: lead.contactName,
    email: lead.email,
    phone: lead.phone,
    category: lead.category,
    interested_tier: lead.tier || null,
    message: lead.message || null,
    source: 'advertise_page',
    user_agent: String(userAgent || '').slice(0, 300) || null,
  }
}

export function adLeadEmail(row, origin = 'https://clemsonrides.com') {
  return {
    subject: `New advertising lead: ${row.business_name}`,
    text: [
      `${row.business_name} wants to advertise on the Clemson Rides in-car tablets.`,
      '',
      `Contact: ${row.contact_name}`,
      `Email: ${row.email}`,
      `Phone: ${row.phone}`,
      `Category: ${row.category}`,
      `Interested tier: ${row.interested_tier || 'not picked'}`,
      row.message ? `Message: ${row.message}` : null,
      '',
      `Leads are in Supabase table ad_partner_leads. Page: ${origin}/advertise`,
    ].filter((line) => line !== null).join('\n'),
  }
}
