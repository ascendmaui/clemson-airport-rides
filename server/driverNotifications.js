/**
 * Inbox rows for driver pushes. The Driver app reads public.driver_notifications
 * under RLS. Inserts come from the service-role server (or the signup trigger).
 * A missing table is a no-op so offer delivery keeps working before the migration.
 */
import { randomUUID } from 'node:crypto'

const MISSING = /driver_notifications|schema cache|does not exist|42P01|PGRST205|PGRST204/i

function clean(value, max) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function rowId(inserted) {
  const data = inserted?.data
  if (data && typeof data === 'object' && !Array.isArray(data) && data.id) return data.id
  if (Array.isArray(data) && data[0]?.id) return data[0].id
  return null
}

/** Insert one inbox row. Never throws. */
export async function insertDriverNotification(sb, {
  userId,
  type,
  title,
  body,
  data,
  id,
} = {}) {
  if (!sb || typeof sb.from !== 'function' || !userId) {
    return { ok: false, id: null, reason: 'notification_target_missing' }
  }
  const notificationId = id || randomUUID()
  const row = {
    id: notificationId,
    user_id: userId,
    type: clean(type, 80) || 'driver_alert',
    title: clean(title, 180) || 'Clemson Rides',
    body: clean(body, 500),
    data: data && typeof data === 'object' && !Array.isArray(data) ? data : {},
  }
  try {
    const table = sb.from('driver_notifications')
    if (!table || typeof table.insert !== 'function') {
      return { ok: false, id: null, reason: 'insert_unavailable' }
    }
    const inserted = await table.insert(row)
    if (inserted?.error) {
      const message = inserted.error.message || ''
      if (MISSING.test(message) || ['42P01', 'PGRST205', 'PGRST204'].includes(inserted.error.code)) {
        return { ok: false, id: null, reason: 'notifications_unavailable' }
      }
      if (inserted.error.code === '23505' || /duplicate key|unique/i.test(message)) {
        return { ok: true, id: notificationId, reason: 'duplicate' }
      }
      return { ok: false, id: null, reason: 'notification_insert_failed' }
    }
    return { ok: true, id: rowId(inserted) || notificationId, reason: 'inserted' }
  } catch (error) {
    const message = error?.message || String(error)
    if (MISSING.test(message)) return { ok: false, id: null, reason: 'notifications_unavailable' }
    return { ok: false, id: null, reason: 'notification_insert_failed' }
  }
}
