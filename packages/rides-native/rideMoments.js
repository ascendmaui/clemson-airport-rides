/**
 * Moment → feedback mapping shared by the Rider and Driver apps.
 * Each function compares the previous snapshot with the new row and returns
 * a toast (+ which cue to play) or null. Keys are stable per trip/event, so
 * the shared toast store merges repeats instead of stacking them.
 */

function money(cents) {
  return `$${((Number(cents) || 0) / 100).toFixed(2)}`
}

function driverCancelCount(row) {
  const list = row?.metadata?.driver_cancels
  return Array.isArray(list) ? list.length : 0
}

/** Snapshot the fields the rider moments compare. */
export function riderTripSnapshot(row) {
  return row?.id ? { status: row.status || null, driverCancels: driverCancelCount(row), hold: fareHoldStatus(row) } : null
}

/** Rider: driver arrived, trip complete, or the driver canceled. */
export function riderTripMoment(prev, row) {
  if (!prev || !row?.id) return null
  const cancels = driverCancelCount(row)
  if (cancels > prev.driverCancels) {
    return {
      key: `driver-canceled:${row.id}:${cancels}`,
      tone: 'warning',
      title: 'Your driver canceled',
      body: row.status === 'searching' || row.status === 'offered'
        ? 'We are finding you another driver. You were not charged for this.'
        : 'You were not charged for this. Book again when you are ready.',
      cue: 'canceled',
    }
  }
  if (row.status === prev.status) return null
  if (row.status === 'arrived') {
    return {
      key: `arrived:${row.id}`,
      tone: 'success',
      title: 'Your driver is here',
      body: row.pickup_label ? `At ${row.pickup_label}` : 'Head to your pickup spot.',
      cue: 'arrived',
    }
  }
  if (row.status === 'completed') {
    return {
      key: `completed:${row.id}`,
      tone: 'success',
      title: 'Trip complete',
      body: row.dropoff_label ? `You made it to ${row.dropoff_label}.` : 'Thanks for riding with Clemson RIDES.',
      cue: 'complete',
    }
  }
  return null
}

/** The trip's fare-hold status (metadata.fare_authorization.status), or null. */
export function fareHoldStatus(row) {
  const status = row?.metadata?.fare_authorization?.status
  return typeof status === 'string' ? status : null
}

/** Either app: the trip's fare hold moved into 'failed'. prevHold undefined = first sight (no toast). */
export function paymentFailedMoment(prevHold, row, role = 'rider') {
  if (!row?.id || prevHold === undefined) return null
  const hold = fareHoldStatus(row)
  if (hold !== 'failed' || prevHold === 'failed') return null
  const amount = row.metadata?.fare_authorization?.amountCents ?? row.metadata?.fare_authorization?.amount_cents
  return {
    key: `payment-failed:${row.id}`,
    tone: 'error',
    title: role === 'driver' ? 'Rider payment hold failed' : 'Payment hold failed',
    body: role === 'driver'
      ? 'The rider’s card was declined. Wait for an update before you drive to pickup.'
      : `We could not hold ${amount ? money(amount) : 'the fare'} on your card. Update your payment method to keep this ride.`,
    cue: 'error',
  }
}

/** Driver: a tip landed (or grew) on a trip. */
export function driverTipMoment(prevTipCents, row) {
  const tip = Number(row?.tip_cents ?? row?.metadata?.tip_cents) || 0
  if (!row?.id || prevTipCents == null || tip <= prevTipCents) return null
  return {
    key: `tip:${row.id}`,
    tone: 'success',
    title: `Tip received · ${money(tip)}`,
    body: row.pickup_label && row.dropoff_label ? `${row.pickup_label} → ${row.dropoff_label}` : 'Thanks for a great ride.',
    cue: 'tip',
  }
}

/** Either app: a chat message from the other person while the app is open. */
export function chatMessageMoment(message, selfId, { viewingTripId = null } = {}) {
  if (!message?.id || !message.sender_id || message.sender_id === selfId) return null
  if (viewingTripId && message.trip_id === viewingTripId) return null
  const text = String(message.body || message.text || '').trim()
  return {
    key: `chat:${message.trip_id || 'trip'}`,
    tone: 'info',
    title: 'New message',
    body: text ? (text.length > 90 ? `${text.slice(0, 89)}…` : text) : 'Open the trip to read it.',
    cue: 'chat',
  }
}

/** Driver offline queue: signal came back and saved taps went through. */
export function backOnlineMoment(sentCount) {
  const n = Number(sentCount) || 0
  if (n <= 0) return null
  return {
    key: 'back-online',
    tone: 'success',
    title: 'Back online',
    body: `${n} ${n === 1 ? 'tap' : 'taps'} sent.`,
    cue: 'online',
  }
}
