/**
 * When a ride is scheduled, every approved driver gets a board alert.
 * In-app is the board row plus the open-app toast. Push goes through the same
 * Expo sender as live offers (server/driverOfferAlerts.js), after the alert row
 * claims the driver, and honors ride-alerts-off and quiet hours.
 * SMS and email stay on the live-offer flag path and are not used here.
 */
import { readDriverPushTokens } from './driverPushToken.js'
import { sendExpoPush, PUSH_CREDENTIAL_GAP } from './expoPush.js'
import { insertDriverNotification } from './driverNotifications.js'
import { noteExpoPushResult } from './expoPushReceipts.js'
import { isQuietForDriverOffer } from './driverOfferAlerts.js'
import { isE2ETestUser } from '../shared/e2eTestAccounts.js'
import { eligibleDriverIdsForRider } from './e2eDriverEligibility.js'
import { isSimulatedDriverId } from '../packages/rides-native/simulatedDrivers.js'
import { scheduledBoardCopy, SCHEDULED_BOARD_MARKER } from '../shared/nearTermSlots.js'

export { SCHEDULED_BOARD_MARKER }

const PUSH_GAP = PUSH_CREDENTIAL_GAP

function approvedRow(row) {
  return String(row?.onboarding_status || '').trim().toLowerCase() === 'approved'
}

async function rowsOf(query) {
  const result = await query
  if (result?.error) throw new Error(result.error.message || 'Could not read drivers')
  return result?.data || []
}

export function boardAlertChannels({ pushTokenPresent = false, title = '', body = '' } = {}) {
  return {
    in_app: { sent: true, reason: 'scheduled_board', title, body },
    push: {
      sent: false,
      reason: pushTokenPresent ? 'push_not_sent' : 'push_token_missing',
      tokenPresent: Boolean(pushTokenPresent),
    },
    sms: { sent: false, reason: 'board_prefers_in_app' },
    email: { sent: false, reason: 'board_prefers_in_app' },
  }
}

async function loadAlertPrefs(sb, ids) {
  try {
    const result = await sb.from('profiles').select('id, notification_prefs').in('id', ids)
    if (result?.error || !Array.isArray(result?.data)) return new Map()
    return new Map(result.data.map((row) => [row.id, row.notification_prefs || null]))
  } catch {
    return new Map()
  }
}

function pushSuppressed(prefs, now) {
  if (prefs && prefs.ride === false) return 'ride_alerts_off'
  if (isQuietForDriverOffer(prefs, now)) return 'quiet_hours'
  return null
}

export async function notifyScheduledBoard(sb, { trip, riderIsE2E } = {}, deps = {}) {
  const tripId = trip?.id
  if (!sb || !tripId) {
    return { ok: false, notified: 0, drivers: 0, reason: 'alert_target_missing', pushGap: PUSH_GAP }
  }
  try {
    const applications = await rowsOf(sb.from('driver_applications').select('profile_id, onboarding_status'))
    let ids = []
    for (const row of applications) {
      const id = row?.profile_id
      if (!approvedRow(row) || !id || isSimulatedDriverId(id) || id === trip.rider_id) continue
      if (!ids.includes(id)) ids.push(id)
    }
    let e2eRider = riderIsE2E === true || trip.metadata?.e2e_test === true
    if (riderIsE2E === undefined && !e2eRider && trip.rider_id) {
      try {
        const rider = await sb.from('profiles').select('email').eq('id', trip.rider_id).maybeSingle()
        if (!rider.error) e2eRider = isE2ETestUser(rider.data)
      } catch { /* Unknown rider identity defaults to real. */ }
    }
    ids = await eligibleDriverIdsForRider(sb, ids, e2eRider)
    if (!ids.length) {
      return { ok: true, notified: 0, drivers: 0, reason: 'no_drivers', pushGap: PUSH_GAP, marker: SCHEDULED_BOARD_MARKER }
    }
    const [tokens, priorRows] = await Promise.all([
      readDriverPushTokens(sb, ids),
      rowsOf(sb.from('driver_offer_alerts').select('driver_id, offer_marker').eq('trip_id', tripId).eq('offer_marker', SCHEDULED_BOARD_MARKER)),
    ])
    const already = new Set((priorRows || []).map((row) => row.driver_id).filter(Boolean))
    const tokenOwners = ids.filter((id) => tokens.get(id)?.token && !already.has(id))
    const prefsById = tokenOwners.length ? await loadAlertPrefs(sb, tokenOwners) : new Map()
    const now = deps.now ? new Date(deps.now) : new Date()
    let pushesSent = 0
    const copy = scheduledBoardCopy(trip)
    let notified = 0
    let pushTokens = 0
    for (const driverId of ids) {
      const pushTokenPresent = Boolean(tokens.get(driverId)?.token)
      if (pushTokenPresent) pushTokens += 1
      if (already.has(driverId)) {
        notified += 1
        continue
      }
      const channels = boardAlertChannels({ pushTokenPresent, title: copy.title, body: copy.body })
      const token = tokens.get(driverId)?.token
      if (token) {
        channels.push.tokenKind = /^Expo(nent)?PushToken\[/.test(token) ? 'expo' : 'raw'
        if (channels.push.tokenKind === 'raw') channels.push.reason = 'raw_device_token_unsupported'
      }
      const inserted = await sb.from('driver_offer_alerts').insert({
        trip_id: tripId,
        driver_id: driverId,
        offer_marker: SCHEDULED_BOARD_MARKER,
        channels,
      })
      if (inserted?.error) {
        const raced = await rowsOf(
          sb.from('driver_offer_alerts').select('driver_id').eq('trip_id', tripId).eq('driver_id', driverId).eq('offer_marker', SCHEDULED_BOARD_MARKER),
        )
        if (!raced.length) continue
        notified += 1
        continue
      }
      notified += 1
      // The insert above is the per-driver claim, so a retry never pushes twice.
      if (token && channels.push.tokenKind === 'expo') {
        const prefs = prefsById.get(driverId) || null
        const suppressed = pushSuppressed(prefs, now)
        if (suppressed) {
          channels.push = { ...channels.push, sent: false, reason: suppressed }
        } else {
          const mode = prefs?.ride_alerts && typeof prefs.ride_alerts === 'object'
            ? prefs.ride_alerts[trip?.metadata?.ride_option || 'standard'] || prefs.ride_alerts.standard
            : null
          const boardData = { tripId, kind: 'scheduled_board' }
          const recorded = await insertDriverNotification(sb, {
            userId: driverId,
            type: 'scheduled_board',
            title: copy.title,
            body: copy.body,
            data: boardData,
          })
          if (recorded.id) boardData.notificationId = recorded.id
          const pushed = await sendExpoPush({
            to: token,
            title: copy.title,
            body: copy.body,
            sound: mode === 'silent' || mode === 'vibrate' ? null : 'default',
            data: boardData,
          }, deps)
          channels.push = {
            sent: Boolean(pushed.sent),
            reason: pushed.reason,
            tokenPresent: true,
            tokenKind: 'expo',
            ...(pushed.gap ? { gap: pushed.gap } : {}),
          }
          if (pushed.sent) pushesSent += 1
          await noteExpoPushResult(sb, { push: pushed, token, ownerId: driverId, ownerRole: 'driver' })
        }
        try {
          const update = sb.from('driver_offer_alerts')
          if (typeof update.update === 'function') {
            await update.update({ channels }).eq('trip_id', tripId).eq('driver_id', driverId).eq('offer_marker', SCHEDULED_BOARD_MARKER)
          }
        } catch { /* audit only; the alert row already exists */ }
      }
    }
    return {
      ok: true,
      notified,
      drivers: ids.length,
      pushTokens,
      pushesSent,
      pushGap: PUSH_GAP,
      marker: SCHEDULED_BOARD_MARKER,
      title: copy.title,
      body: copy.body,
    }
  } catch (error) {
    console.error('[scheduled-board]', tripId, error?.message || error)
    return {
      ok: false,
      notified: 0,
      drivers: 0,
      reason: 'board_alert_failed',
      pushGap: PUSH_GAP,
      marker: SCHEDULED_BOARD_MARKER,
    }
  }
}
