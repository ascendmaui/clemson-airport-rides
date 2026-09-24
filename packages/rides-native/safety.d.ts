export const SHARE_ORIGIN: string
export const CUPD_PHONE_E164: string
export const CUPD_PHONE_DISPLAY: string
export const CUPD_EMAIL: string
export const SHAREABLE_TRIP_STATUSES: readonly string[]
export const ACTIVE_RIDE_STATUSES: readonly string[]
export const SOS_CHANNELS: readonly string[]
export const ALERT_CHANNELS: readonly string[]
export const MAX_EMERGENCY_CONTACTS: number

export type SosChannel = 'tel_911' | 'tel_cupd' | 'sms' | 'mailto' | 'web_share' | 'banner'

export type LocationShare = {
  id: string
  token: string
  active: boolean
  url: string
}

export type EmergencyContact = {
  id: string
  user_id: string
  name: string
  phone: string
  relationship: string | null
  created_at?: string
  updated_at?: string
}

export type SosEvent = {
  id: string
  user_id: string
  trip_id: string
  lat: number | null
  lng: number | null
  channel: string
  created_at: string
}

export function isShareableTripStatus(status: string | null | undefined): boolean
export function isActiveRideStatus(status: string | null | undefined): boolean
export function shareUrl(token: string, origin?: string): string
export function makeShareToken(): string
export function tripShareMessage(input: {
  pickup?: string | null
  dropoff?: string | null
  url?: string | null
  status?: string | null
}): string
export function buildSosText(input: { lat?: number | null; lng?: number | null; tripId?: string | null }): string
export function sosChannelHref(channel: string, text: string): string | null
export function sosChannelButton(channel: string): { title: string; detail: string }
export function sosChannelPhrase(channel: string): string
export function normalizeContactPhone(raw: string): { ok: true; phone: string } | { ok: false; error: string }
export function contactTel(phone: string): string | null
export function validateEmergencyContact(input: {
  name?: string
  phone?: string
  relationship?: string | null
}): { ok: true; contact: { name: string; phone: string; relationship: string | null } } | { ok: false; error: string }

export function findActiveLocationShare(
  supabase: unknown,
  tripId: string,
  origin?: string,
): Promise<LocationShare | null>

export function createLocationShare(
  supabase: unknown,
  tripId: string,
  riderId: string,
  origin?: string,
): Promise<LocationShare>

export function postLocationPoint(
  supabase: unknown,
  input: { shareId: string; lat: number; lng: number; accuracy?: number | null },
): Promise<void>

export function revokeLocationShare(supabase: unknown, shareId: string): Promise<void>

export function logSosEvent(
  supabase: unknown,
  input: { tripId?: string | null; userId?: string | null; lat?: number | null; lng?: number | null; channel: string },
): Promise<{ ok: true; event: SosEvent } | { ok: false; error: string }>

export function fetchRecentSosEvents(supabase: unknown, tripId: string): Promise<SosEvent[]>

export function listEmergencyContacts(
  supabase: unknown,
  userId: string,
): Promise<{ contacts: EmergencyContact[]; error: string | null }>

export function saveEmergencyContact(
  supabase: unknown,
  userId: string,
  input: { id?: string; name?: string; phone?: string; relationship?: string | null },
): Promise<{ ok: true; contact: EmergencyContact } | { ok: false; error: string }>

export function deleteEmergencyContact(
  supabase: unknown,
  userId: string,
  contactId: string,
): Promise<{ ok: boolean; error?: string }>
