/**
 * When a ride is scheduled, every approved driver gets a board alert.
 * In-app is the board row plus the open-app toast. Push has no server sender.
 * SMS and email stay on the live-offer flag path and are not used here.
 */
import { isSimulatedDriverId } from '../packages/rides-native/simulatedDrivers.js'
import { scheduledBoardCopy, SCHEDULED_BOARD_MARKER } from '../shared/nearTermSlots.js'

export { SCHEDULED_BOARD_MARKER }

const PUSH_GAP = 'Expo push tokens can be stored on driver_status or driver_push_tokens. No server push sender is configured, so a closed app is not pinged. In-app board alerts still record, and the open driver app shows a local notification.'

function approvedRow(row) {
  return String(row?.onboarding_status || '').trim().toLowerCase() === 'approved'
}

async function rowsOf(query) {
  const result = await query
  if (result?.error) throw new Error(result.error.message || 'Could not read drivers')
  return result?.data || []
}

function tokenFor(driverId, statusRows, tokenRows) {
  const status = (statusRows || []).find((row) => row?.driver_id === driverId)
  const stored = (tokenRows || []).find((row) => row?.driver_id === driverId)
  return Boolean(String(status?.expo_push_token || '').trim() || String(stored?.token || '').trim())
}

export function boardAlertChannels({ pushTokenPresent = false, title = '', body = '' } = {}) {
  return {
    in_app: { sent: true, reason: 'scheduled_board', title, body },
    push: {
      sent: false,
      reason: pushTokenPresent ? 'push_sender_missing' : 'push_token_missing',
      tokenPresent: Boolean(pushTokenPresent),
    },
    sms: { sent: false, reason: 'board_prefers_in_app' },
    email: { sent: false, reason: 'board_prefers_in_app' },
  }
}

export async function notifyScheduledBoard(sb, { trip } = {}) {
  const tripId = trip?.id
  if (!sb || !tripId) {
    return { ok: false, notified: 0, drivers: 0, reason: 'alert_target_missing', pushGap: PUSH_GAP }
  }
  try {
    const applications = await rowsOf(sb.from('driver_applications').select('profile_id, onboarding_status'))
    const ids = []
    for (const row of applications) {
      const id = row?.profile_id
      if (!approvedRow(row) || !id || isSimulatedDriverId(id) || id === trip.rider_id) continue
      if (!ids.includes(id)) ids.push(id)
    }
    if (!ids.length) {
      return { ok: true, notified: 0, drivers: 0, reason: 'no_drivers', pushGap: PUSH_GAP, marker: SCHEDULED_BOARD_MARKER }
    }
    const [statusRows, tokenRows, priorRows] = await Promise.all([
      rowsOf(sb.from('driver_status').select('driver_id, expo_push_token').in('driver_id', ids)),
      rowsOf(sb.from('driver_push_tokens').select('driver_id, token').in('driver_id', ids)),
      rowsOf(sb.from('driver_offer_alerts').select('driver_id, offer_marker').eq('trip_id', tripId).eq('offer_marker', SCHEDULED_BOARD_MARKER)),
    ])
    const already = new Set((priorRows || []).map((row) => row.driver_id).filter(Boolean))
    const copy = scheduledBoardCopy(trip)
    let notified = 0
    let pushTokens = 0
    for (const driverId of ids) {
      const pushTokenPresent = tokenFor(driverId, statusRows, tokenRows)
      if (pushTokenPresent) pushTokens += 1
      if (already.has(driverId)) {
        notified += 1
        continue
      }
      const channels = boardAlertChannels({ pushTokenPresent, title: copy.title, body: copy.body })
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
      }
      notified += 1
    }
    return {
      ok: true,
      notified,
      drivers: ids.length,
      pushTokens,
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
