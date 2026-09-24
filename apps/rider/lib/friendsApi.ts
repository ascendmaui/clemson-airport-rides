import { authedJson } from 'rides-native/apiClient.js'
import { authStorage } from '@/lib/storage'
import { supabase } from '@/lib/supabase'

const FRIENDS_KEY = 'rider.friends'

export type SavedFriend = { id: string; name: string; email: string }

export type FriendActivity = {
  id: string
  token: string | null
  status: string | null
  kind: string | null
  split_mode: string | null
  total_fare_cents: number | null
  created_at: string | null
}

export async function loadSavedFriends(): Promise<SavedFriend[]> {
  const raw = await authStorage.getItem(FRIENDS_KEY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((row): row is SavedFriend => {
      if (!row || typeof row !== 'object') return false
      const friend = row as SavedFriend
      return typeof friend.email === 'string' && typeof friend.name === 'string'
    })
  } catch {
    return []
  }
}

async function persistFriends(friends: SavedFriend[]) {
  await authStorage.setItem(FRIENDS_KEY, JSON.stringify(friends))
}

export async function addFriendByEmail(email: string) {
  const normalized = email.trim().toLowerCase()
  if (!normalized.includes('@')) throw new Error('Enter an email address.')
  if (!supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .ilike('email', normalized)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data?.id) throw new Error('No rider with that email yet.')
  const friend: SavedFriend = {
    id: String(data.id),
    name: String(data.full_name || data.email || 'Tiger'),
    email: String(data.email || normalized),
  }
  const existing = await loadSavedFriends()
  const next = [friend, ...existing.filter((row) => row.id !== friend.id)].slice(0, 20)
  await persistFriends(next)
  return next
}

export async function listFriendActivity(userId: string) {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('friend_rides')
    .select('id, token, status, kind, split_mode, total_fare_cents, created_at')
    .eq('organizer_id', userId)
    .order('created_at', { ascending: false })
    .limit(8)
  if (error) throw new Error(error.message)
  return (data || []) as FriendActivity[]
}

export async function startRideTogether({
  displayName,
  pickup,
  dropoff,
  splitMode,
  partyType,
}: {
  displayName: string
  pickup: { label: string; lat: number; lng: number }
  dropoff: { label: string; lat: number; lng: number }
  splitMode: 'even' | 'by_distance'
  partyType: 'carpool' | 'tailgate'
}) {
  return authedJson(supabase, '/api/friend-rides?action=create', {
    method: 'POST',
    body: {
      displayName,
      pickup,
      dropoff,
      splitMode,
      kind: 'friends',
      partyType,
    },
  })
}
