import { authStorage } from '@/lib/storage'
import { supabase } from '@/lib/supabase'

export const NOTIFICATION_CATEGORIES = [
  { id: 'ride', label: 'Ride updates', hint: 'Requested, accepted, arriving, completed' },
  { id: 'billing', label: 'Billing & receipts', hint: 'Fares, payment failures, receipts' },
  { id: 'friends', label: 'Friends / carpool', hint: 'Someone joined, split updated, location shared' },
  { id: 'promotions', label: 'Promotions', hint: 'Deals, surge alerts, campus campaigns' },
  { id: 'system', label: 'System', hint: 'Account, verification, security' },
] as const

export type NotificationId = (typeof NOTIFICATION_CATEGORIES)[number]['id']

export type NotificationPrefs = Record<NotificationId, boolean>

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  ride: true,
  billing: true,
  friends: true,
  promotions: false,
  system: true,
}

export type RiderProfile = {
  full_name: string | null
  bio: string | null
  email: string | null
  student_verified_at: string | null
  favorite_spots: string[]
  notification_prefs: Partial<NotificationPrefs> | null
  stripe_card_brand: string | null
  stripe_card_last4: string | null
  rating_avg: number | null
  rating_count: number | null
}

export type HistoryRow = {
  id: string
  status: string | null
  pickup_label: string | null
  dropoff_label: string | null
  created_at: string | null
}

const PREFS_KEY = (userId: string) => `rider.notif.${userId}`

function asSpots(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter((spot): spot is string => typeof spot === 'string').slice(0, 6)
}

function asPrefs(value: unknown): NotificationPrefs {
  const raw = value && typeof value === 'object' ? (value as Partial<NotificationPrefs>) : {}
  return {
    ride: raw.ride !== false,
    billing: raw.billing !== false,
    friends: raw.friends !== false,
    promotions: Boolean(raw.promotions),
    system: raw.system !== false,
  }
}

export async function loadAccount(userId: string) {
  let localPrefs = DEFAULT_NOTIFICATION_PREFS
  const stored = await authStorage.getItem(PREFS_KEY(userId))
  if (stored) {
    try {
      localPrefs = asPrefs(JSON.parse(stored))
    } catch {
      localPrefs = DEFAULT_NOTIFICATION_PREFS
    }
  }
  if (!supabase) return { profile: null as RiderProfile | null, prefs: localPrefs, error: 'Supabase is not configured' }
  const queried = await supabase
    .from('profiles')
    .select('full_name, bio, email, student_verified_at, favorite_spots, notification_prefs, stripe_card_brand, stripe_card_last4, rating_avg, rating_count')
    .eq('id', userId)
    .maybeSingle()
    // A rejected fetch must not throw: the account screen has no .catch.
    .then((row) => row, () => null)
  if (!queried) {
    return {
      profile: null as RiderProfile | null,
      prefs: localPrefs,
      error: 'Could not load your account. Check your connection and try again.',
    }
  }
  const { data, error } = queried
  if (error) return { profile: null as RiderProfile | null, prefs: localPrefs, error: error.message }
  const profile = data
    ? {
        full_name: data.full_name ?? null,
        bio: data.bio ?? null,
        email: data.email ?? null,
        student_verified_at: data.student_verified_at ?? null,
        favorite_spots: asSpots(data.favorite_spots),
        notification_prefs: (data.notification_prefs as Partial<NotificationPrefs> | null) ?? null,
        stripe_card_brand: data.stripe_card_brand ?? null,
        stripe_card_last4: data.stripe_card_last4 ?? null,
        rating_avg: data.rating_avg ?? null,
        rating_count: data.rating_count ?? null,
      }
    : null
  const prefs = profile?.notification_prefs ? asPrefs(profile.notification_prefs) : localPrefs
  return { profile, prefs, error: null as string | null }
}

export async function saveProfile(userId: string, patch: { full_name: string; bio: string; favorite_spots: string[] }) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase
    .from('profiles')
    .update({
      full_name: patch.full_name.trim() || null,
      bio: patch.bio.trim() || null,
      favorite_spots: patch.favorite_spots.slice(0, 6),
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId)
  if (error) throw new Error(error.message)
}

export async function saveNotificationPrefs(userId: string, prefs: NotificationPrefs) {
  await authStorage.setItem(PREFS_KEY(userId), JSON.stringify(prefs))
  if (!supabase) return { persisted: false, note: 'Saved on this phone.' }
  const { error } = await supabase
    .from('profiles')
    .update({ notification_prefs: prefs, updated_at: new Date().toISOString() })
    .eq('id', userId)
  if (error) return { persisted: false, note: `Saved on this phone. ${error.message}` }
  return { persisted: true, note: 'Saved to your profile.' }
}

export async function listHistory(userId: string) {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('trips')
    .select('id, status, pickup_label, dropoff_label, created_at')
    .eq('rider_id', userId)
    .order('created_at', { ascending: false })
    .limit(12)
  if (error) throw new Error(error.message)
  return (data || []) as HistoryRow[]
}
