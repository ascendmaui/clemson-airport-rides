/**
 * Expo push tickets and later receipts.
 * A send ticket of status "ok" does not mean APNs accepted the alert.
 * DeviceNotRegistered usually shows up on the receipt, minutes later.
 * Tickets are stored only when expo_push_tickets exists. Until that
 * OPS migration is applied, sends still work and this sweep is a no-op.
 */
import { fetchExpoPushReceipts, receiptDropsToken, expoReceiptError } from './expoPush.js'

export const RECEIPT_MIN_AGE_MS = 15 * 1000
export const RECEIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000

function missingTable(error) {
  return ['42P01', 'PGRST205'].includes(error?.code) || /expo_push_tickets|does not exist|schema cache/i.test(error?.message || '')
}

export async function recordExpoPushTicket(sb, { ticketId, token, ownerId = null, ownerRole = null } = {}) {
  const id = String(ticketId || '').trim()
  const pushToken = String(token || '').trim()
  if (!sb || !id || !pushToken) return { stored: false, reason: 'ticket_missing' }
  const role = ownerRole === 'rider' || ownerRole === 'driver' ? ownerRole : null
  try {
    const inserted = await sb.from('expo_push_tickets').insert({
      ticket_id: id,
      token: pushToken,
      owner_id: ownerId || null,
      owner_role: role,
    })
    if (inserted?.error) {
      if (missingTable(inserted.error)) return { stored: false, unavailable: true }
      if (/duplicate|23505/i.test(inserted.error.message || '')) return { stored: true, duplicate: true }
      return { stored: false, reason: 'insert_failed' }
    }
    return { stored: true }
  } catch (error) {
    if (missingTable(error)) return { stored: false, unavailable: true }
    return { stored: false, reason: 'insert_failed' }
  }
}

/** Drop one stored Expo token. A newer token on the same person is left in place. */
export async function forgetExpoPushToken(sb, { token, ownerId = null, ownerRole = null } = {}) {
  const pushToken = String(token || '').trim()
  if (!sb || !pushToken) return { dropped: false }
  const roles = ownerRole === 'rider' || ownerRole === 'driver' ? [ownerRole] : ['rider', 'driver']
  if (roles.includes('rider')) {
    let query = sb.from('rider_push_tokens').delete().eq('token', pushToken)
    if (ownerId) query = query.eq('rider_id', ownerId)
    await query
  }
  if (roles.includes('driver')) {
    let query = sb.from('driver_push_tokens').delete().eq('token', pushToken)
    if (ownerId) query = query.eq('driver_id', ownerId)
    await query
    try {
      let status = sb.from('driver_status').update({ expo_push_token: null }).eq('expo_push_token', pushToken)
      if (ownerId) status = status.eq('driver_id', ownerId)
      await status
    } catch {
      /* The legacy column is not in the migrations. A missing column must not block the private delete. */
    }
  }
  return { dropped: true }
}

/** Remember a ticket and drop a token Expo has already rejected. Never throws. */
export async function noteExpoPushResult(sb, { push, token, ownerId = null, ownerRole = null } = {}) {
  if (!sb || !push) return
  try {
    if (push.ticketId) {
      await recordExpoPushTicket(sb, { ticketId: push.ticketId, token, ownerId, ownerRole })
    }
    if (push.reason === 'device_not_registered') {
      await forgetExpoPushToken(sb, { token, ownerId, ownerRole })
    }
  } catch (err) {
    console.error('[expo-push-receipts]', err?.message || err)
  }
}

function pendingTickets(rows, nowMs) {
  const ready = []
  let waiting = 0
  for (const row of rows || []) {
    if (!row?.ticket_id || row.checked_at) continue
    const age = nowMs - Date.parse(row.created_at || 0)
    if (!Number.isFinite(age) || age < RECEIPT_MIN_AGE_MS) {
      waiting += 1
      continue
    }
    ready.push(row)
  }
  return { ready, waiting }
}

export async function sweepExpoPushReceipts(sb, { now = new Date(), dryRun = false, fetchReceipts = fetchExpoPushReceipts } = {}) {
  if (dryRun) return { checked: 0, dropped: 0, pending: 0 }
  const nowMs = new Date(now).getTime()
  const nowIso = new Date(nowMs).toISOString()
  let loaded
  try {
    loaded = await sb.from('expo_push_tickets').select('ticket_id, token, owner_id, owner_role, created_at, checked_at').is('checked_at', null).limit(100)
  } catch (error) {
    if (missingTable(error)) return { checked: 0, dropped: 0, pending: 0, unavailable: true }
    throw error
  }
  if (loaded?.error) {
    if (missingTable(loaded.error)) return { checked: 0, dropped: 0, pending: 0, unavailable: true }
    throw new Error(loaded.error.message || 'Could not load Expo push tickets')
  }
  const { ready, waiting } = pendingTickets(loaded.data, nowMs)
  if (!ready.length) return { checked: 0, dropped: 0, pending: waiting }
  const receipts = await fetchReceipts(ready.map((row) => row.ticket_id), {})
  if (!receipts.ok) return { checked: 0, dropped: 0, pending: waiting + ready.length, reason: receipts.reason || 'expo_receipts_failed' }
  let checked = 0
  let dropped = 0
  let pending = waiting
  for (const row of ready) {
    const receipt = receipts.receipts?.[row.ticket_id]
    const expired = nowMs - Date.parse(row.created_at || 0) >= RECEIPT_MAX_AGE_MS
    if (!receipt && !expired) {
      pending += 1
      continue
    }
    const error = receipt ? expoReceiptError(receipt) : 'expired'
    if (receipt && receiptDropsToken(receipt)) {
      try {
        await forgetExpoPushToken(sb, { token: row.token, ownerId: row.owner_id, ownerRole: row.owner_role })
        dropped += 1
      } catch (err) {
        console.error('[expo-push-receipts] drop', err?.message || err)
      }
    }
    const marked = await sb.from('expo_push_tickets').update({
      checked_at: nowIso,
      receipt_status: receipt?.status || 'expired',
      receipt_error: error,
    }).eq('ticket_id', row.ticket_id).is('checked_at', null)
    if (!marked?.error) checked += 1
  }
  return { checked, dropped, pending }
}
