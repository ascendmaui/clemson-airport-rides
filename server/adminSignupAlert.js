/**
 * Signup alerts go only to John's admin account.
 * The database trigger inserts the inbox row and pokes this module through
 * pg_net. This module sends the Expo push and inserts the row again if the
 * trigger has not landed yet. Other drivers never receive it.
 */
import { readDriverPushToken } from './driverPushToken.js'
import { insertDriverNotification } from './driverNotifications.js'
import { sendExpoPush } from './expoPush.js'
import { noteExpoPushResult } from './expoPushReceipts.js'

export const ADMIN_SIGNUP_USER_ID = 'f2262bf6-1fef-4d90-9e2e-7edfb7f097dc'

export function adminSignupRecipientId() {
  return ADMIN_SIGNUP_USER_ID
}

export function adminSignupCopy({ email, fullName } = {}) {
  const name = String(fullName || '').replace(/\s+/g, ' ').trim()
  const address = String(email || '').replace(/\s+/g, ' ').trim()
  let who = 'A new account'
  if (name && address) who = `${name} (${address})`
  else if (name || address) who = name || address
  return {
    title: 'New Clemson Rides account',
    body: `${who} just signed up.`,
  }
}

async function alreadyRecorded(sb, recipientId, signupUserId) {
  try {
    const table = sb.from('driver_notifications')
    if (!table || typeof table.select !== 'function') return false
    const listed = await table.select('id, user_id, type, data').eq('user_id', recipientId).eq('type', 'admin_signup')
    const rows = Array.isArray(listed?.data) ? listed.data : []
    return rows.some((row) => String(row?.data?.signup_user_id || '') === signupUserId)
  } catch {
    return false
  }
}

/**
 * Record the inbox row and push John's phone only.
 * `recipientId` in the request is ignored so a caller cannot retarget the alert.
 */
export async function deliverAdminSignupAlert(sb, input = {}, deps = {}) {
  const signupUserId = String(input.userId || input.signupUserId || '').trim()
  if (!signupUserId) return { ok: false, reason: 'signup_user_missing', pushed: false }
  const recipientId = adminSignupRecipientId()
  const copy = adminSignupCopy({ email: input.email, fullName: input.fullName || input.full_name })
  const data = {
    kind: 'admin_signup',
    signup_user_id: signupUserId,
    email: String(input.email || '').trim() || null,
    full_name: String(input.fullName || input.full_name || '').trim() || null,
    source: String(input.source || '').trim() || null,
  }
  const recorded = await alreadyRecorded(sb, recipientId, signupUserId)
    ? { ok: true, id: null, reason: 'duplicate' }
    : await insertDriverNotification(sb, {
      userId: recipientId,
      type: 'admin_signup',
      title: copy.title,
      body: copy.body,
      data,
    })
  const tokenRow = await readDriverPushToken(sb, recipientId)
  const token = tokenRow?.token || null
  if (!token) {
    return { ok: true, pushed: false, reason: 'push_token_missing', recipientId, recorded: recorded.reason }
  }
  const send = deps.sendExpoPush || sendExpoPush
  const push = await send({
    to: token,
    title: copy.title,
    body: copy.body,
    sound: 'default',
    channelId: 'ride-requests',
    data: recorded.id ? { ...data, notificationId: recorded.id } : data,
  }, deps)
  await noteExpoPushResult(sb, {
    push,
    token,
    ownerId: recipientId,
    ownerRole: 'driver',
  })
  return {
    ok: true,
    pushed: Boolean(push?.sent),
    reason: push?.reason || (push?.sent ? 'sent' : 'not_sent'),
    recipientId,
    recorded: recorded.reason,
  }
}
