/**
 * Rider safety helpers shared by the native rider app.
 * Live location uses public.location_shares / location_points (same as src/lib/locationShare.js).
 * SOS uses public.sos_events (same channels as src/lib/sosAlert.js).
 * Emergency contacts use public.emergency_contacts.
 */

import { WEB_ORIGIN } from '../../shared/productLinks.js'

export const SHARE_ORIGIN = WEB_ORIGIN

export const CUPD_PHONE_E164 = '+18646562222'
export const CUPD_PHONE_DISPLAY = '(864) 656-2222'
export const CUPD_EMAIL = 'police@clemson.edu'

export const SHAREABLE_TRIP_STATUSES = ['searching', 'offered', 'accepted', 'arriving', 'in_progress']
export const ACTIVE_RIDE_STATUSES = ['accepted', 'arriving', 'in_progress']
export const SOS_CHANNELS = ['tel_911', 'tel_cupd', 'sms', 'mailto', 'web_share', 'banner']
export const ALERT_CHANNELS = ['tel_911', 'tel_cupd', 'sms', 'mailto', 'web_share']
export const MAX_EMERGENCY_CONTACTS = 5

const RECENT_SOS_MS = 6 * 60 * 60 * 1000

export function isShareableTripStatus(status) {
  return SHAREABLE_TRIP_STATUSES.includes(status)
}

export function isActiveRideStatus(status) {
  return ACTIVE_RIDE_STATUSES.includes(status)
}

export function shareUrl(token, origin = SHARE_ORIGIN) {
  const clean = String(token || '').trim()
  if (!clean) throw new Error('Share token required')
  const base = String(origin || SHARE_ORIGIN).replace(/\/$/, '')
  return `${base}/share/${encodeURIComponent(clean)}`
}

export function makeShareToken() {
  try {
    const cryptoApi = globalThis.crypto
    if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
      const bytes = new Uint8Array(16)
      cryptoApi.getRandomValues(bytes)
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    }
  } catch {
    /* fall through */
  }
  return `share_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
}

export function tripShareMessage({ pickup, dropoff, url, status }) {
  const lines = ['Follow my Clemson RIDES trip']
  if (pickup || dropoff) lines.push(`${pickup || 'Pickup'} → ${dropoff || 'Dropoff'}`)
  if (status) lines.push(`Status: ${status}`)
  if (url) lines.push(url)
  return lines.join('\n')
}

export function buildSosText({ lat, lng, tripId }) {
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng)
  const coordText = hasCoords
    ? `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`
    : 'GPS unavailable'
  const lines = [
    'SOS Clemson RIDES',
    `Trip: ${tripId || 'unknown'}`,
    `Location: ${coordText}`,
  ]
  if (hasCoords) {
    lines.push(`https://maps.google.com/maps?q=${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`)
  }
  lines.push('Active campus ride. Need help now.')
  return lines.join('\n')
}

export function sosChannelHref(channel, text) {
  switch (channel) {
    case 'tel_911':
      return 'tel:911'
    case 'tel_cupd':
      return `tel:${CUPD_PHONE_E164}`
    case 'sms':
      return `sms:911?&body=${encodeURIComponent(text)}`
    case 'mailto':
      return `mailto:${CUPD_EMAIL}?subject=${encodeURIComponent('SOS Clemson RIDES')}&body=${encodeURIComponent(text)}`
    case 'web_share':
    case 'banner':
      return null
    default: {
      const unknown = channel
      throw new Error(`Unknown SOS channel: ${String(unknown)}`)
    }
  }
}

export function sosChannelButton(channel) {
  switch (channel) {
    case 'tel_911':
      return { title: 'Call 911', detail: 'Emergency voice call' }
    case 'tel_cupd':
      return { title: 'Call Clemson Police', detail: `${CUPD_PHONE_DISPLAY} · campus safety` }
    case 'sms':
      return { title: 'Text 911', detail: 'Lat/lng and trip id · main campus' }
    case 'mailto':
      return { title: 'Email Clemson Police', detail: CUPD_EMAIL }
    case 'web_share':
      return { title: 'Share location', detail: 'Share sheet with lat/lng and trip id' }
    case 'banner':
      return { title: 'Alert the other person', detail: 'In-app banner on this trip' }
    default: {
      const unknown = channel
      throw new Error(`Unknown SOS channel: ${String(unknown)}`)
    }
  }
}

export function sosChannelPhrase(channel) {
  switch (channel) {
    case 'tel_911':
      return 'called 911'
    case 'tel_cupd':
      return 'called Clemson Police'
    case 'sms':
      return 'texted 911 with their location'
    case 'mailto':
      return 'emailed Clemson Police'
    case 'web_share':
      return 'shared their live location'
    case 'banner':
      return 'sent an in-app SOS'
    default: {
      const unknown = channel
      return `activated SOS (${String(unknown)})`
    }
  }
}

export function normalizeContactPhone(raw) {
  const text = String(raw || '').trim()
  const digits = text.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) {
    return { ok: false, error: 'Enter a phone number with 7 to 15 digits' }
  }
  const phone = text.startsWith('+') ? `+${digits}` : digits
  return { ok: true, phone }
}

export function contactTel(phone) {
  const text = String(phone || '').trim()
  const digits = text.replace(/\D/g, '')
  if (!digits) return null
  if (text.startsWith('+')) return `tel:+${digits}`
  if (digits.length === 10) return `tel:+1${digits}`
  // Seven digits is a local number (656-2222). tel:+6562222 is not a valid call.
  if (digits.length === 7) return `tel:${digits}`
  return `tel:+${digits}`
}

export function validateEmergencyContact(input) {
  const name = String(input?.name || '').trim()
  const relationship = String(input?.relationship || '').trim()
  if (name.length < 1 || name.length > 80) {
    return { ok: false, error: 'Enter a name up to 80 characters' }
  }
  const phoneResult = normalizeContactPhone(input?.phone)
  if (!phoneResult.ok) return phoneResult
  if (relationship.length > 40) {
    return { ok: false, error: 'Relationship must be 40 characters or fewer' }
  }
  return {
    ok: true,
    contact: {
      name,
      phone: phoneResult.phone,
      relationship: relationship || null,
    },
  }
}

function firstRow(data) {
  if (Array.isArray(data)) return data[0] || null
  return data || null
}

export async function findActiveLocationShare(supabase, tripId, origin = SHARE_ORIGIN) {
  if (!supabase || !tripId) return null
  const { data, error } = await supabase
    .from('location_shares')
    .select('id, token, active')
    .eq('trip_id', tripId)
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(error.message)
  const row = firstRow(data)
  if (!row?.token) return null
  return { id: row.id, token: row.token, active: row.active !== false, url: shareUrl(row.token, origin) }
}

export async function createLocationShare(supabase, tripId, riderId, origin = SHARE_ORIGIN) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!tripId || !riderId) throw new Error('trip and rider required')
  const existing = await findActiveLocationShare(supabase, tripId, origin)
  if (existing?.token) return existing

  const token = makeShareToken()
  const { data, error } = await supabase
    .from('location_shares')
    .insert({ trip_id: tripId, rider_id: riderId, active: true, token })
    .select('id, token, active')
    .single()
  if (error) throw new Error(error.message)
  if (!data?.token) throw new Error('Share created without token')
  return { id: data.id, token: data.token, active: data.active !== false, url: shareUrl(data.token, origin) }
}

export async function postLocationPoint(supabase, { shareId, lat, lng, accuracy }) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!shareId) throw new Error('share required')
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('GPS coordinates required')
  const { error } = await supabase.from('location_points').insert({
    share_id: shareId,
    lat,
    lng,
    accuracy_m: Number.isFinite(accuracy) ? accuracy : null,
  })
  if (error) throw new Error(error.message)
}

export async function revokeLocationShare(supabase, shareId) {
  if (!supabase || !shareId) return
  const { error } = await supabase
    .from('location_shares')
    .update({ active: false, revoked_at: new Date().toISOString() })
    .eq('id', shareId)
  if (error) throw new Error(error.message)
}

export async function logSosEvent(supabase, { tripId, userId, lat, lng, channel }) {
  if (!SOS_CHANNELS.includes(channel)) return { ok: false, error: 'Unknown SOS channel' }
  if (!supabase) return { ok: false, error: 'Supabase is not configured' }
  if (!tripId || !userId) return { ok: false, error: 'Sign in on an active trip to save this SOS' }
  const row = {
    user_id: userId,
    trip_id: tripId,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    channel,
  }
  const { data, error } = await supabase
    .from('sos_events')
    .insert(row)
    .select('id, user_id, trip_id, lat, lng, channel, created_at')
    .single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, event: data }
}

export async function fetchRecentSosEvents(supabase, tripId) {
  if (!supabase || !tripId) return []
  const since = new Date(Date.now() - RECENT_SOS_MS).toISOString()
  const { data, error } = await supabase
    .from('sos_events')
    .select('id, user_id, trip_id, lat, lng, channel, created_at')
    .eq('trip_id', tripId)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) return []
  return data || []
}

export async function listEmergencyContacts(supabase, userId) {
  if (!supabase) return { contacts: [], error: 'Supabase is not configured' }
  if (!userId) return { contacts: [], error: null }
  const { data, error } = await supabase
    .from('emergency_contacts')
    .select('id, user_id, name, phone, relationship, created_at, updated_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) return { contacts: [], error: error.message }
  return { contacts: data || [], error: null }
}

export async function saveEmergencyContact(supabase, userId, input) {
  const parsed = validateEmergencyContact(input)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  if (!supabase) return { ok: false, error: 'Supabase is not configured' }
  if (!userId) return { ok: false, error: 'Sign in to save an emergency contact' }

  const now = new Date().toISOString()
  if (input?.id) {
    const { data, error } = await supabase
      .from('emergency_contacts')
      .update({
        name: parsed.contact.name,
        phone: parsed.contact.phone,
        relationship: parsed.contact.relationship,
        updated_at: now,
      })
      .eq('id', input.id)
      .eq('user_id', userId)
      .select('id, user_id, name, phone, relationship, created_at, updated_at')
      .single()
    if (error) return { ok: false, error: error.message }
    if (!data) return { ok: false, error: 'Contact not found' }
    return { ok: true, contact: data }
  }

  const existing = await listEmergencyContacts(supabase, userId)
  if (existing.error) return { ok: false, error: existing.error }
  if (existing.contacts.length >= MAX_EMERGENCY_CONTACTS) {
    return { ok: false, error: 'You can save up to 5 emergency contacts' }
  }

  const { data, error } = await supabase
    .from('emergency_contacts')
    .insert({
      user_id: userId,
      name: parsed.contact.name,
      phone: parsed.contact.phone,
      relationship: parsed.contact.relationship,
      updated_at: now,
    })
    .select('id, user_id, name, phone, relationship, created_at, updated_at')
    .single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, contact: data }
}

export async function deleteEmergencyContact(supabase, userId, contactId) {
  if (!supabase) return { ok: false, error: 'Supabase is not configured' }
  if (!userId || !contactId) return { ok: false, error: 'Contact required' }
  const { error } = await supabase
    .from('emergency_contacts')
    .delete()
    .eq('id', contactId)
    .eq('user_id', userId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
