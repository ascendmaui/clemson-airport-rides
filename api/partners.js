/**
 * Rental Partner portal API.
 *   GET  ?action=me                  partner account, listings, requests (driver contact only after accept)
 *   POST ?action=signup              partner application (status pending)
 *   POST ?action=listing             create/update a listing (shared vehicle standards enforced)
 *   POST ?action=listing-status      pause / unpause
 *   POST ?action=transition          accept | decline | active | ended | canceled
 *   GET  ?action=browse              cleared drivers: approved, available listings + own requests
 *   POST ?action=interest            driver "I'm interested"
 *   GET  ?action=admin-queue         admin: partners + listings
 *   POST ?action=admin-partner       admin: approve | reject | suspend partner
 *   POST ?action=admin-listing       admin: approve | reject listing
 * No payments between partners and drivers in v1 (off-platform).
 */
import { admin, cors, json, parseBody, userFromAuth } from '../server/friendRideLib.js'
import { serverIsAdmin } from '../server/adminRoster.js'
import { notify, adminRecipients } from '../server/rentalNotify.js'
import {
  PARTNER_TERMS_VERSION, partnerSignupErrors, evaluateListing, listingRow, driverRentalEligible,
} from '../shared/rentalPartner.js'
import { applyTransition, contactVisible } from '../shared/rentalStateMachine.js'

const ACTIONS = new Set(['me', 'signup', 'listing', 'listing-status', 'transition', 'browse', 'interest', 'admin-queue', 'admin-partner', 'admin-listing'])
const VEHICLE_FACTS = ['year', 'make', 'model', 'vin', 'title_status', 'condition', 'luxury_exception']
const BROWSE_COLS = 'id, partner_id, make, model, year, body_style, seats, mileage, photos, weekly_price_cents, deposit_cents, mileage_limit_weekly, insurance_included, maintenance_included, basics_included, min_driver_age, available_from, available_until, pickup_location, rental_partners(business_name, city, service_area)'

const vehicleName = (l) => [l?.year, l?.make, l?.model].filter(Boolean).join(' ')

async function loadPartner(sb, uid) {
  const { data } = await sb.from('rental_partners').select('*').eq('profile_id', uid).maybeSingle()
  return data || null
}

async function isAdmin(sb, user) {
  const { data: p } = await sb.from('profiles').select('email, role, is_admin').eq('id', user.id).maybeSingle()
  return serverIsAdmin({ jwtEmail: user.email, profileEmail: p?.email, role: p?.role, isAdmin: p?.is_admin })
}

async function driverApp(sb, uid) {
  const { data } = await sb.from('driver_applications')
    .select('onboarding_status, background_check_status, background_admin_reviewed_at')
    .eq('profile_id', uid).order('created_at', { ascending: false }).limit(1).maybeSingle()
  return data || null
}

export async function driverCard(sb, request) {
  const { data: p } = await sb.from('profiles').select('full_name, phone, email, rating_avg, rating_count').eq('id', request.driver_id).maybeSingle()
  const app = await driverApp(sb, request.driver_id)
  const show = contactVisible(request.status)
  return {
    name: p?.full_name || 'Driver',
    rating: p?.rating_count ? Number(p.rating_avg) : null,
    ratingCount: p?.rating_count || 0,
    checkStatus: driverRentalEligible(app) ? 'License and background check passed' : 'Not cleared',
    phone: show ? p?.phone || null : null,
    email: show ? p?.email || null : null,
  }
}

export default async function handler(req, res) {
  if (cors(req, res)) return
  const url = new URL(req.url || '/', 'http://localhost')
  const action = url.searchParams.get('action') || ''
  if (!ACTIONS.has(action)) return json(res, 404, { error: 'Unknown action' })
  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })
  let body = {}
  if (req.method === 'POST') {
    const parsed = parseBody(req)
    if (parsed.error) return json(res, 400, { error: parsed.error })
    body = parsed.body
  }
  try {
    switch (action) {
      case 'me': return await me(sb, res, user)
      case 'signup': return await signup(sb, res, user, body)
      case 'listing': return await saveListing(sb, res, user, body)
      case 'listing-status': return await listingStatus(sb, res, user, body)
      case 'transition': return await transition(sb, res, user, body)
      case 'browse': return await browse(sb, res, user)
      case 'interest': return await interest(sb, res, user, body)
      default:
        if (!(await isAdmin(sb, user))) return json(res, 403, { error: 'Admin only' })
        if (action === 'admin-queue') return await adminQueue(sb, res)
        if (action === 'admin-partner') return await adminPartner(sb, res, body)
        return await adminListing(sb, res, body)
    }
  } catch (err) {
    return json(res, 500, { error: err.message || String(err) })
  }
}

async function me(sb, res, user) {
  const partner = await loadPartner(sb, user.id)
  if (!partner) return json(res, 200, { partner: null, listings: [], requests: [] })
  const { data: listings } = await sb.from('rental_listings').select('*').eq('partner_id', partner.id).order('created_at', { ascending: false })
  const { data: reqs } = await sb.from('rental_requests').select('*').eq('partner_id', partner.id).order('created_at', { ascending: false })
  const requests = []
  for (const r of reqs || []) requests.push({ ...r, driver: await driverCard(sb, r), vehicle: vehicleName((listings || []).find((l) => l.id === r.listing_id)) })
  return json(res, 200, { partner, listings: listings || [], requests })
}

async function signup(sb, res, user, b) {
  const errors = partnerSignupErrors(b)
  if (Object.keys(errors).length) return json(res, 400, { error: 'Fix the highlighted fields.', errors })
  if (await loadPartner(sb, user.id)) return json(res, 409, { error: 'You already have a partner account.' })
  const row = {
    profile_id: user.id,
    business_name: b.businessName.trim(), contact_name: b.contactName.trim(), phone: b.phone.trim(),
    email: b.email.trim(), city: b.city.trim(), service_area: b.serviceArea.trim(),
    terms_version: PARTNER_TERMS_VERSION, terms_accepted_at: new Date().toISOString(), status: 'pending',
  }
  const { data, error } = await sb.from('rental_partners').insert(row).select('*').single()
  if (error) return json(res, 400, { error: error.message })
  await notify('partner_applied', adminRecipients(), { businessName: row.business_name, city: row.city })
  return json(res, 200, { partner: data })
}

async function saveListing(sb, res, user, b) {
  const partner = await loadPartner(sb, user.id)
  if (!partner) return json(res, 403, { error: 'Sign up as a partner first.' })
  if (partner.status !== 'approved') return json(res, 403, { error: 'Your partner account is pending admin approval.' })
  const result = evaluateListing(b)
  if (!result.reviewStatus || Object.keys(result.errors).length) {
    return json(res, 400, { error: 'Fix the highlighted fields.', errors: result.errors })
  }
  const row = listingRow(b, partner.id, result.reviewStatus, result.cents)
  if (b.id) {
    const { data: existing } = await sb.from('rental_listings').select('*').eq('id', b.id).eq('partner_id', partner.id).maybeSingle()
    if (!existing) return json(res, 404, { error: 'Listing not found' })
    const same = VEHICLE_FACTS.every((k) => String(existing[k]) === String(row[k]))
      && JSON.stringify(existing.condition_photos) === JSON.stringify(row.condition_photos)
    if (same && result.reviewStatus !== 'rejected') row.review_status = existing.review_status
    const { data, error } = await sb.from('rental_listings').update(row).eq('id', b.id).select('*').single()
    if (error) return json(res, 400, { error: error.message })
    return json(res, 200, { listing: data, reasons: result.reasons })
  }
  const { data, error } = await sb.from('rental_listings').insert(row).select('*').single()
  if (error) return json(res, 400, { error: error.message })
  return json(res, 200, { listing: data, reasons: result.reasons })
}

async function listingStatus(sb, res, user, b) {
  const partner = await loadPartner(sb, user.id)
  if (!partner) return json(res, 403, { error: 'Not a partner' })
  if (!['active', 'paused'].includes(b.status)) return json(res, 400, { error: 'status must be active or paused' })
  const { data, error } = await sb.from('rental_listings').update({ status: b.status })
    .eq('id', b.id).eq('partner_id', partner.id).select('id, status').maybeSingle()
  if (error) return json(res, 400, { error: error.message })
  if (!data) return json(res, 404, { error: 'Listing not found' })
  return json(res, 200, { listing: data })
}

async function transition(sb, res, user, b) {
  const { data: r } = await sb.from('rental_requests').select('*').eq('id', b.requestId).maybeSingle()
  if (!r) return json(res, 404, { error: 'Request not found' })
  const partner = await loadPartner(sb, user.id)
  const actor = partner && partner.id === r.partner_id ? 'partner' : r.driver_id === user.id ? 'driver' : (await isAdmin(sb, user)) ? 'admin' : null
  if (!actor) return json(res, 403, { error: 'Not allowed' })
  let patch
  try {
    patch = applyTransition(r, b.to, actor, { startDate: b.startDate, endDate: b.endDate })
  } catch (err) {
    return json(res, 400, { error: err.message })
  }
  const { data, error } = await sb.from('rental_requests').update(patch).eq('id', r.id).eq('status', r.status).select('*').maybeSingle()
  if (error) return json(res, 400, { error: error.message })
  if (!data) return json(res, 409, { error: 'Request changed, reload.' })
  if (b.to === 'accepted' || b.to === 'declined') {
    const { data: l } = await sb.from('rental_listings').select('year, make, model').eq('id', r.listing_id).maybeSingle()
    const { data: p } = await sb.from('rental_partners').select('business_name').eq('id', r.partner_id).maybeSingle()
    const { data: d } = await sb.from('profiles').select('email').eq('id', r.driver_id).maybeSingle()
    await notify(b.to === 'accepted' ? 'request_accepted' : 'request_declined', d?.email, { businessName: p?.business_name, vehicle: vehicleName(l) })
  }
  return json(res, 200, { request: { ...data, driver: actor === 'driver' ? undefined : await driverCard(sb, data) } })
}

async function browse(sb, res, user) {
  const app = await driverApp(sb, user.id)
  if (!driverRentalEligible(app)) {
    return json(res, 200, { eligible: false, listings: [], requests: [], reason: 'Rentals open after your license is approved and your background check passes.' })
  }
  const today = new Date().toISOString().slice(0, 10)
  const { data: listings, error } = await sb.from('rental_listings').select(BROWSE_COLS)
    .eq('status', 'active').eq('review_status', 'approved').eq('rental_partners.status', 'approved')
    .order('weekly_price_cents', { ascending: true })
  if (error) return json(res, 500, { error: error.message })
  const visible = (listings || []).filter((l) => l.rental_partners && (!l.available_until || l.available_until >= today))
  const { data: requests } = await sb.from('rental_requests').select('id, listing_id, status, start_date, end_date, created_at').eq('driver_id', user.id)
  return json(res, 200, { eligible: true, listings: visible, requests: requests || [] })
}

async function interest(sb, res, user, b) {
  const app = await driverApp(sb, user.id)
  if (!driverRentalEligible(app)) return json(res, 403, { error: 'Rentals open after your license and background check pass.' })
  const { data: l } = await sb.from('rental_listings').select('id, partner_id, year, make, model, status, review_status, rental_partners(status, email)')
    .eq('id', b.listingId).maybeSingle()
  if (!l || l.status !== 'active' || l.review_status !== 'approved' || l.rental_partners?.status !== 'approved') {
    return json(res, 404, { error: 'Listing is not available.' })
  }
  const { data, error } = await sb.from('rental_requests').insert({
    listing_id: l.id, partner_id: l.partner_id, driver_id: user.id, status: 'requested',
    message: String(b.message || '').slice(0, 500) || null,
  }).select('*').single()
  if (error) {
    if (/duplicate|unique/i.test(error.message)) return json(res, 409, { error: 'You already have an open request for this vehicle.' })
    return json(res, 400, { error: error.message })
  }
  await notify('driver_interested', l.rental_partners?.email, { vehicle: vehicleName(l) })
  return json(res, 200, { request: data })
}

async function adminQueue(sb, res) {
  const { data: partners } = await sb.from('rental_partners').select('*').order('created_at', { ascending: false })
  const { data: listings } = await sb.from('rental_listings').select('*, rental_partners(business_name)').order('created_at', { ascending: false })
  return json(res, 200, { partners: partners || [], listings: listings || [] })
}

async function adminPartner(sb, res, b) {
  const status = { approve: 'approved', reject: 'rejected', suspend: 'suspended' }[b.decision]
  if (!status) return json(res, 400, { error: 'decision must be approve, reject or suspend' })
  const { data, error } = await sb.from('rental_partners').update({ status, review_note: b.note || null }).eq('id', b.id).select('*').maybeSingle()
  if (error) return json(res, 400, { error: error.message })
  if (!data) return json(res, 404, { error: 'Partner not found' })
  if (status !== 'suspended') {
    await notify(status === 'approved' ? 'partner_approved' : 'partner_rejected', data.email, { contactName: data.contact_name, businessName: data.business_name, note: b.note })
  }
  return json(res, 200, { partner: data })
}

async function adminListing(sb, res, b) {
  const review = { approve: 'approved', reject: 'rejected' }[b.decision]
  if (!review) return json(res, 400, { error: 'decision must be approve or reject' })
  const { data, error } = await sb.from('rental_listings').update({ review_status: review, review_note: b.note || null })
    .eq('id', b.id).select('*, rental_partners(email)').maybeSingle()
  if (error) return json(res, 400, { error: error.message })
  if (!data) return json(res, 404, { error: 'Listing not found' })
  await notify('listing_reviewed', data.rental_partners?.email, { decision: review, vehicle: vehicleName(data), note: b.note })
  return json(res, 200, { listing: data })
}
