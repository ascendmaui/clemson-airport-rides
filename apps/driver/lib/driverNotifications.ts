import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { uniqueChannelTopic } from 'rides-native/realtimeChannel.js'

export type DriverNotice = {
  id: string
  type: string
  title: string
  body: string
  data: Record<string, unknown>
  read_at: string | null
  created_at: string
}

const unreadListeners = new Set<(count: number) => void>()
let unreadCount = 0

export function publishUnreadCount(count: number) {
  unreadCount = Math.max(0, count)
  for (const listener of unreadListeners) listener(unreadCount)
}

export function useUnreadNotificationCount() {
  const [count, setCount] = useState(unreadCount)
  useEffect(() => {
    unreadListeners.add(setCount)
    return () => { unreadListeners.delete(setCount) }
  }, [])
  return count
}

export function noticeData(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function asDriverNotice(row: unknown): DriverNotice | null {
  if (!row || typeof row !== 'object') return null
  const record = row as Record<string, unknown>
  const id = typeof record.id === 'string' ? record.id : ''
  if (!id) return null
  return {
    id,
    type: typeof record.type === 'string' ? record.type : '',
    title: typeof record.title === 'string' ? record.title : 'Clemson Rides',
    body: typeof record.body === 'string' ? record.body : '',
    data: noticeData(record.data),
    read_at: typeof record.read_at === 'string' ? record.read_at : null,
    created_at: typeof record.created_at === 'string' ? record.created_at : '',
  }
}

export function isRideOfferNotice(notice: { type?: string; data?: Record<string, unknown> | null }) {
  const type = notice.type || ''
  const kind = notice.data && typeof notice.data.kind === 'string' ? notice.data.kind : ''
  return type === 'ride_offer' || kind === 'ride_offer'
}

export function tripIdOf(notice: { data?: Record<string, unknown> | null }) {
  const data = notice.data || {}
  const id = data.tripId || data.trip_id
  return typeof id === 'string' ? id.trim() : ''
}

export function noticeDedupeKey(notice: { id?: string; title?: string; data?: Record<string, unknown> | null }) {
  const data = notice.data || {}
  const notificationId = notice.id || (typeof data.notificationId === 'string' ? data.notificationId : '')
  if (notificationId) return `id:${notificationId}`
  const tripId = typeof data.tripId === 'string' ? data.tripId : ''
  const kind = typeof data.kind === 'string' ? data.kind : ''
  return `fallback:${kind}:${tripId}:${notice.title || ''}`
}

export async function loadDriverNotifications(supabase: SupabaseClient, userId: string): Promise<DriverNotice[]> {
  const { data, error } = await supabase
    .from('driver_notifications')
    .select('id, type, title, body, data, read_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(error.message || 'Could not load notifications')
  return (Array.isArray(data) ? data : []).map(asDriverNotice).filter((row): row is DriverNotice => Boolean(row))
}

export async function refreshUnreadCount(supabase: SupabaseClient, userId: string) {
  const { count, error } = await supabase
    .from('driver_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null)
  if (error) return unreadCount
  publishUnreadCount(count || 0)
  return unreadCount
}

export async function markDriverNotificationRead(supabase: SupabaseClient, userId: string, id: string) {
  const readAt = new Date().toISOString()
  const { error } = await supabase
    .from('driver_notifications')
    .update({ read_at: readAt })
    .eq('id', id)
    .eq('user_id', userId)
    .is('read_at', null)
  if (error) throw new Error(error.message || 'Could not mark this notification read')
  await refreshUnreadCount(supabase, userId)
}

export async function markAllDriverNotificationsRead(supabase: SupabaseClient, userId: string) {
  const readAt = new Date().toISOString()
  const { error } = await supabase
    .from('driver_notifications')
    .update({ read_at: readAt })
    .eq('user_id', userId)
    .is('read_at', null)
  if (error) throw new Error(error.message || 'Could not mark notifications read')
  publishUnreadCount(0)
}

export async function loadNewDriverNotifications(supabase: SupabaseClient, userId: string, since: string): Promise<DriverNotice[]> {
  const { data, error } = await supabase
    .from('driver_notifications')
    .select('id, type, title, body, data, read_at, created_at')
    .eq('user_id', userId)
    .gt('created_at', since)
    .order('created_at', { ascending: true })
    .limit(20)
  if (error) return []
  return (Array.isArray(data) ? data : []).map(asDriverNotice).filter((row): row is DriverNotice => Boolean(row))
}

/** Realtime inserts for this driver. Polling covers a project that has not enabled the publication yet. */
export function subscribeDriverNotificationInserts(
  supabase: SupabaseClient,
  userId: string,
  onInsert: (notice: DriverNotice) => void,
) {
  const channel = supabase
    .channel(uniqueChannelTopic(`driver-notifications-${userId}`))
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'driver_notifications',
      filter: `user_id=eq.${userId}`,
    }, (payload: { new?: unknown }) => {
      const notice = asDriverNotice(payload?.new)
      if (notice) onInsert(notice)
    })
    .subscribe()
  return () => { void supabase.removeChannel(channel) }
}
