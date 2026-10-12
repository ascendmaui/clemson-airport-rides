/** Transactional Rental Partner emails through the existing Resend helper. Best-effort. */
import { sendApplicantNotice } from './applicantMail.js'
import { adminNotifyRecipients } from './adminRoster.js'

import { WEB_ORIGIN } from '../shared/productLinks.js'
const ORIGIN = () => WEB_ORIGIN

export function rentalEmail(kind, ctx = {}) {
  const o = ORIGIN()
  switch (kind) {
    case 'partner_applied':
      return { subject: `New rental partner: ${ctx.businessName}`, text: `${ctx.businessName} (${ctx.city}) applied to be a rental partner. Review it at ${o}/admin.` }
    case 'partner_approved':
      return { subject: 'You are approved as a Clemson RIDES rental partner', text: `Hi ${ctx.contactName || ''}, your partner account for ${ctx.businessName} is approved. Add vehicles at ${o}/partners.` }
    case 'partner_rejected':
      return { subject: 'Your Clemson RIDES partner application', text: `Hi ${ctx.contactName || ''}, we could not approve ${ctx.businessName} right now.${ctx.note ? ` Note: ${ctx.note}` : ''}` }
    case 'listing_reviewed':
      return { subject: `Listing ${ctx.decision}: ${ctx.vehicle}`, text: `Your listing ${ctx.vehicle} was ${ctx.decision} by Clemson RIDES.${ctx.note ? ` Note: ${ctx.note}` : ''} ${o}/partners` }
    case 'driver_interested':
      return { subject: `A driver is interested in your ${ctx.vehicle}`, text: `A cleared Clemson RIDES driver sent an "I'm interested" request for your ${ctx.vehicle}. Accept or decline at ${o}/partners. Contact details appear after you accept.` }
    case 'request_accepted':
      return { subject: `${ctx.businessName} accepted your rental request`, text: `${ctx.businessName} accepted your request for the ${ctx.vehicle}. They will contact you to arrange pickup. Payment is arranged directly with the partner, off-platform. ${o}/drivers/rentals` }
    case 'request_declined':
      return { subject: 'Rental request update', text: `${ctx.businessName} declined your request for the ${ctx.vehicle}. Browse other rentals at ${o}/drivers/rentals.` }
    default:
      return null
  }
}

export async function notify(kind, to, ctx, send = sendApplicantNotice) {
  const msg = rentalEmail(kind, ctx)
  if (!msg) return { emailed: false }
  const list = Array.isArray(to) ? to : [to]
  const out = []
  for (const addr of list.filter(Boolean)) out.push(await send({ to: addr, ...msg }))
  return out
}

export function adminRecipients() {
  return adminNotifyRecipients()
}
