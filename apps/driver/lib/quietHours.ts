import { useEffect, useState } from 'react'
import { fetchNotificationPrefs, normalizePrefs, saveNotificationPrefs, type NotificationPrefs } from 'rides-native/notificationPrefs.js'
import { authStorage } from '@/lib/storage'
import { supabase } from '@/lib/supabase'

/**
 * Driver quiet hours live in profiles.notification_prefs.quiet (the same
 * prefs the web app and the server offer push read), so one save covers the
 * in-app chime/buzz, local notifications, and server-sent offer pushes.
 */
let cached: { userId: string; prefs: NotificationPrefs; at: number } | null = null
const listeners = new Set<(prefs: NotificationPrefs) => void>()

export async function driverAlertPrefs(userId: string, maxAgeMs = 60000): Promise<NotificationPrefs> {
  if (cached && cached.userId === userId && Date.now() - cached.at < maxAgeMs) return cached.prefs
  const { prefs } = await fetchNotificationPrefs(supabase, authStorage, userId)
  cached = { userId, prefs, at: Date.now() }
  return prefs
}

export async function saveDriverQuiet(userId: string, quiet: Partial<NotificationPrefs['quiet']>) {
  const base = await driverAlertPrefs(userId, 0)
  const next = normalizePrefs({ ...base, quiet: { ...base.quiet, ...quiet } })
  const result = await saveNotificationPrefs(supabase, authStorage, userId, next)
  cached = { userId, prefs: next, at: Date.now() }
  for (const listener of listeners) listener(next)
  return result
}

export function useDriverAlertPrefs(userId: string | null | undefined) {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(cached?.userId === userId ? cached.prefs : null)
  useEffect(() => {
    if (!userId) return undefined
    let alive = true
    driverAlertPrefs(userId, 0).then((p) => { if (alive) setPrefs(p) }).catch(() => {})
    listeners.add(setPrefs)
    return () => {
      alive = false
      listeners.delete(setPrefs)
    }
  }, [userId])
  return prefs
}
