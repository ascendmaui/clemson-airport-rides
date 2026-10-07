/**
 * Backup-driver queue for scheduled rides.
 * Two drivers deep: a primary and one backup. Pure rules live here so the
 * dispatch tick, payouts, and both rider/driver clients share one definition.
 *
 * JOHN — confirm these defaults before they ship to drivers:
 * 1. Window opens at pickup − drive time − 10 min, clamped to 20–60 min before
 *    pickup. The driver then has 5 minutes to confirm. After confirm, Leave now
 *    is pickup minus the drive. At that time navigation and GPS start, and that
 *    counts as started driving. A confirmed driver is not released before then.
 * 2. If the backup is never needed, they still receive the bonus when they
 *    stayed available through the window (offline during the window forfeits it).
 * 3. A primary who misses the window or cancels early gets a reliability strike
 *    and no payout. Early-cancel strikes are included; say if those should differ
 *    from a missed confirm.
 * 4. With no backup, the ride reopens to the live pool marked urgent and the
 *    rider and admin are notified. No automatic refund.
 * 5. Rider cancel of a backup booking captures only the backup fee for the
 *    primary and releases the rest of the hold, including any boost.
 *    A ride with no backup keeps the existing cancel (no fee).
 * 6. A rider may switch to the backup once. The backup fee is paid once, to
 *    the former primary, as a switch fee. That driver does not also earn a
 *    second backup bonus. Switching after the driver has started toward
 *    pickup requires a safety report.
 */

export const BACKUP_QUEUE_DEPTH = 2

/** Rider presets. The bonus is paid to the backup driver, not taken as a deposit. */
export const BACKUP_BONUS_PRESETS_CENTS = Object.freeze([1000, 1500])

/** JOHN: length of the confirm-and-start-driving window. */
export const BACKUP_CONFIRM_WINDOW_MS = 5 * 60 * 1000

/** JOHN: slack subtracted with the drive-time estimate. */
export const BACKUP_WINDOW_BUFFER_MS = 10 * 60 * 1000

/** JOHN: soonest the window may open, measured before scheduled pickup. */
export const BACKUP_WINDOW_FLOOR_MS = 20 * 60 * 1000

/** JOHN: latest the window may open, measured before scheduled pickup. */
export const BACKUP_WINDOW_CEILING_MS = 60 * 60 * 1000

/** Straight-line movement that counts as leaving the curb. */
export const BACKUP_MOVEMENT_METERS = 40

/** How much closer to pickup the latest fix must be. */
export const BACKUP_APPROACH_METERS = 25

/** ~30 mph when a routed drive time is not on the trip. */
export const ASSUMED_DRIVE_MPS = 13.4

export const LOOKING_FOR_BACKUP_LABEL = 'Looking for backup driver'
export const DRIVER_AND_BACKUP_LABEL = 'Driver + backup confirmed'
export const CONFIRM_TRIP_COPY = "You're committed to this trip. You'll go to pickup at the right time and complete the trip."
export const RIDER_ENROUTE_COPY = 'Your driver is on the way. Everything is going as planned. Sit tight.'
export const URGENT_POOL_LABEL = 'Urgent — needs a driver'
export const BOOK_BACKUP_COPY = 'Book a backup driver for an additional $10 or $15'

/** JOHN: a rider can swap to the backup this many times per trip. */
export const BACKUP_SWITCH_LIMIT = 1

export const SWITCH_FEE_LABEL = 'Switch fee'
export const CANCEL_FEE_LABEL = 'Cancellation fee'

/**
 * JOHN: after a switch, the former primary is the backup and does not earn a
 * second backup bonus. The single backup fee is the switch fee.
 */
export const SECOND_BACKUP_BONUS_AFTER_SWITCH = false

/** JOHN: on a rider cancel, the backup driver is not paid. */
export const BACKUP_PAID_ON_RIDER_CANCEL = false

/** JOHN: boost is left on the uncaptured remainder, so the rider is not charged it. */
export const REFUND_BOOST_ON_RIDER_CANCEL = true

/** JOHN: the only post-departure switch is an explicit safety report. */
export const SWITCH_AFTER_DEPARTURE_REQUIRES_SAFETY = true

/** JOHN: a scheduled ride with no backup keeps today's cancel, which charges no fee. */
export const CANCEL_FEE_WITHOUT_BACKUP = false

export function backupBonusLabel(cents) {
  const amount = normalizeBackupBonusCents(cents)
  if (!amount) return null
  return `Backup: +$${amount / 100}`
}

export function normalizeBackupBonusCents(value) {
  const n = Math.round(Number(value) || 0)
  return BACKUP_BONUS_PRESETS_CENTS.includes(n) ? n : null
}

/**
 * Boost from the scheduled-boost work, when that metadata is present.
 * This does not invent a boost. payout = fare + boost + backup bonus.
 * Set metadata.boost_included_in_driver_net when the fare net already contains it.
 */
export function readScheduledBoostCents(metadata) {
  const meta = metadata && typeof metadata === 'object' ? metadata : {}
  if (meta.boost_included_in_driver_net === true) return 0
  const boost = meta.boost && typeof meta.boost === 'object' ? meta.boost : null
  const scheduled = meta.scheduled_boost && typeof meta.scheduled_boost === 'object' ? meta.scheduled_boost : null
  const raw = meta.scheduled_boost_cents
    ?? meta.boost_cents
    ?? meta.scheduledBoostCents
    ?? scheduled?.cents
    ?? scheduled?.amountCents
    ?? boost?.cents
    ?? boost?.amountCents
  const n = Math.round(Number(raw) || 0)
  return n > 0 ? n : 0
}

export function readBackupQueue(trip) {
  const meta = trip?.metadata && typeof trip.metadata === 'object' ? trip.metadata : {}
  const raw = meta.backup_queue && typeof meta.backup_queue === 'object' ? meta.backup_queue : null
  if (!raw?.enabled) return null
  const bonusCents = normalizeBackupBonusCents(raw.bonusCents ?? trip?.backup_bonus_cents)
  if (!bonusCents) return null
  return {
    enabled: true,
    bonusCents,
    primaryDriverId: raw.primaryDriverId || null,
    backupDriverId: raw.backupDriverId || null,
    confirmState: raw.confirmState || 'idle',
    windowOpensAt: raw.windowOpensAt || null,
    windowClosesAt: raw.windowClosesAt || null,
    confirmedAt: raw.confirmedAt || null,
    navigateStartedAt: raw.navigateStartedAt || null,
    leaveNowAt: raw.leaveNowAt || null,
    movementDetectedAt: raw.movementDetectedAt || null,
    promotedFromBackup: raw.promotedFromBackup === true,
    flakedDriverId: raw.flakedDriverId || null,
    generation: Math.max(0, Math.round(Number(raw.generation) || 0)),
    urgent: raw.urgent === true,
    backupStoodBy: raw.backupStoodBy !== false,
    backupOfflineDuringWindow: raw.backupOfflineDuringWindow === true,
    riderNotifiedEnrouteAt: raw.riderNotifiedEnrouteAt || null,
    windowNotifiedAt: raw.windowNotifiedAt || null,
    lastFix: raw.lastFix || null,
    events: Array.isArray(raw.events) ? raw.events.slice(-12) : [],
    strikes: Array.isArray(raw.strikes) ? raw.strikes : [],
    riderNotice: raw.riderNotice || null,
    switchCount: Math.max(0, Math.round(Number(raw.switchCount) || 0)),
    switchFeeDriverId: raw.switchFeeDriverId || null,
    switchFeeCents: Math.max(0, Math.round(Number(raw.switchFeeCents) || 0)),
    backupBonusRedirected: raw.backupBonusRedirected === true,
    primaryCard: raw.primaryCard || null,
    backupCard: raw.backupCard || null,
    driverNotices: raw.driverNotices && typeof raw.driverNotices === 'object' ? raw.driverNotices : {},
    cancelFeeDriverId: raw.cancelFeeDriverId || null,
    cancelFeeCents: Math.max(0, Math.round(Number(raw.cancelFeeCents) || 0)),
    cancelSettledAt: raw.cancelSettledAt || null,
  }
}

export function isBackupQueueRide(trip) {
  return Boolean(readBackupQueue(trip))
}

export function backupSlotOpen(trip) {
  const queue = readBackupQueue(trip)
  if (!queue || queue.confirmState === 'released') return false
  return Boolean(queue.primaryDriverId) && !queue.backupDriverId && queue.confirmState !== 'handed_to_pool'
}

export function lookingForBackup(trip) {
  return backupSlotOpen(trip)
}

export function haversineMeters(a, b) {
  const lat1 = Number(a?.lat)
  const lng1 = Number(a?.lng)
  const lat2 = Number(b?.lat)
  const lng2 = Number(b?.lng)
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null
  const radius = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * radius * Math.asin(Math.sqrt(h))
}

export function estimateDriveMs(from, to) {
  const meters = haversineMeters(from, to)
  if (meters == null) return 0
  return Math.round((meters / ASSUMED_DRIVE_MPS) * 1000)
}

/** Lead time before pickup when the confirm window opens. Clamped 20–60 min. */
export function confirmWindowOpenLeadMs(driveMs) {
  const drive = Number.isFinite(Number(driveMs)) && Number(driveMs) > 0 ? Number(driveMs) : 0
  const raw = drive + BACKUP_WINDOW_BUFFER_MS
  return Math.min(BACKUP_WINDOW_CEILING_MS, Math.max(BACKUP_WINDOW_FLOOR_MS, raw))
}

export function confirmWindowBounds({ pickupAt, driveMs }) {
  const pickup = new Date(pickupAt).getTime()
  if (!Number.isFinite(pickup)) return null
  const leadMs = confirmWindowOpenLeadMs(driveMs)
  const opensAt = pickup - leadMs
  return {
    leadMs,
    opensAt,
    closesAt: opensAt + BACKUP_CONFIRM_WINDOW_MS,
  }
}

/** Pickup time minus the drive. Null when the pickup time is missing. */
export function leaveNowAtMs({ pickupAt, driveMs }) {
  const pickup = Date.parse(pickupAt || '')
  if (!Number.isFinite(pickup)) return null
  const drive = Number.isFinite(Number(driveMs)) && Number(driveMs) > 0 ? Number(driveMs) : 0
  return pickup - drive
}

/** "Leave now in m:ss", or "Leave now" once the depart time has arrived. */
export function leaveNowCountdownLabel(leaveNowAt, now = Date.now()) {
  const at = Date.parse(leaveNowAt || '')
  if (!Number.isFinite(at)) return null
  const clock = now instanceof Date ? now.getTime() : Number(now)
  const left = at - (Number.isFinite(clock) ? clock : Date.now())
  if (left <= 0) return 'Leave now'
  const total = Math.ceil(left / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `Leave now in ${minutes}:${String(seconds).padStart(2, '0')}`
}

/** True once a confirmed driver has reached Leave now and has not departed. */
export function departIsDue({ confirmedAt, leaveNowAt, navigateStartedAt, now = Date.now() } = {}) {
  if (!confirmedAt || navigateStartedAt) return false
  const at = Date.parse(leaveNowAt || '')
  if (!Number.isFinite(at)) return false
  const clock = now instanceof Date ? now.getTime() : Number(now)
  return (Number.isFinite(clock) ? clock : Date.now()) >= at
}

/** mm:ss remaining in the confirm window. Null when the close time is missing. */
export function confirmCountdownLabel(closesAt, now = Date.now()) {
  const closes = Date.parse(closesAt || '')
  if (!Number.isFinite(closes)) return null
  const clock = now instanceof Date ? now.getTime() : Number(now)
  const left = closes - (Number.isFinite(clock) ? clock : Date.now())
  if (left <= 0) return '0:00 left'
  const total = Math.ceil(left / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')} left`
}

/**
 * True when the driver tapped Start/Navigate or GPS shows movement that
 * closes distance to pickup.
 */
export function driverStartedTowardPickup({ pickup, fixes, navigateStartedAt, previousFix, currentFix }) {
  if (navigateStartedAt) return true
  const samples = Array.isArray(fixes) ? fixes.filter((fix) => haversineMeters(fix, pickup) != null) : []
  if (samples.length >= 2) {
    const first = samples[0]
    const last = samples[samples.length - 1]
    const moved = haversineMeters(first, last) >= BACKUP_MOVEMENT_METERS
    const closer = haversineMeters(last, pickup) + BACKUP_APPROACH_METERS < haversineMeters(first, pickup)
    if (moved && closer) return true
  }
  if (previousFix && currentFix && haversineMeters(previousFix, currentFix) != null) {
    const moved = haversineMeters(previousFix, currentFix) >= BACKUP_MOVEMENT_METERS
    const before = haversineMeters(previousFix, pickup)
    const after = haversineMeters(currentFix, pickup)
    if (moved && before != null && after != null && after + BACKUP_APPROACH_METERS < before) return true
  }
  return false
}

export function backupBookingMetadata(bonusCents, now = new Date()) {
  const amount = normalizeBackupBonusCents(bonusCents)
  if (!amount) return null
  return {
    enabled: true,
    bonusCents: amount,
    primaryDriverId: null,
    backupDriverId: null,
    confirmState: 'idle',
    generation: 1,
    backupStoodBy: true,
    bookedAt: now.toISOString(),
    events: [{ kind: 'booked', at: now.toISOString(), bonusCents: amount }],
  }
}

/** Fare that the existing pre-auth should cover before the buffer is added. */
export function preauthBaseCents(fareCents, bonusCents) {
  const fare = Math.max(0, Math.round(Number(fareCents) || 0))
  const bonus = normalizeBackupBonusCents(bonusCents) || 0
  return fare + bonus
}

/** Amount captured at trip end. No 25% deposit. Bonus is included only when booked. */
export function riderCaptureFareCents(trip) {
  const fare = Math.max(0, Math.round(Number(trip?.fare_cents) || 0))
  const queue = readBackupQueue(trip)
  if (!queue || queue.confirmState === 'released') return fare
  return fare + queue.bonusCents
}

function withEvent(queue, event) {
  return {
    ...queue,
    generation: queue.generation + 1,
    events: [...(queue.events || []), event].slice(-12),
  }
}

export function acceptBackupRole(queue, driverId) {
  if (!queue?.enabled) return { ok: false, code: 'backup_not_enabled' }
  if (queue.confirmState === 'released') return { ok: false, code: 'backup_released' }
  if (!driverId) return { ok: false, code: 'driver_required' }
  if (queue.confirmState === 'handed_to_pool') return { ok: false, code: 'reopened_to_pool' }
  if (queue.primaryDriverId === driverId) return { ok: true, role: 'primary', idempotent: true, queue }
  if (queue.backupDriverId === driverId) return { ok: true, role: 'backup', idempotent: true, queue }
  if (!queue.primaryDriverId) {
    return {
      ok: true,
      role: 'primary',
      queue: withEvent({
        ...queue,
        primaryDriverId: driverId,
        confirmState: 'idle',
      }, { kind: 'primary_accepted', at: new Date().toISOString(), driverId }),
    }
  }
  if (!queue.backupDriverId) {
    return {
      ok: true,
      role: 'backup',
      queue: withEvent({
        ...queue,
        backupDriverId: driverId,
        backupStoodBy: true,
      }, { kind: 'backup_accepted', at: new Date().toISOString(), driverId }),
    }
  }
  return { ok: false, code: 'queue_full' }
}

/** Backup driver steps out before they are needed. The seat reopens. No strike. */
export function releaseBackupSeat(queue, driverId, now = new Date().toISOString()) {
  if (!queue?.enabled) return { ok: false, code: 'backup_not_enabled' }
  if (!driverId || queue.backupDriverId !== driverId) return { ok: false, code: 'not_backup' }
  return {
    ok: true,
    queue: withEvent({
      ...queue,
      backupDriverId: null,
      backupStoodBy: false,
    }, { kind: 'backup_released', at: now, driverId }),
  }
}

function strike(queue, driverId, reason, now) {
  return {
    ...queue,
    flakedDriverId: driverId,
    strikes: [...(queue.strikes || []), { driverId, reason, at: now }],
  }
}

/**
 * Primary disappeared. Backup becomes primary and the backup seat reopens.
 * The new primary gets a fresh 5-minute confirm window.
 */
export function promoteBackup(queue, { reason, now = new Date().toISOString() }) {
  if (!queue?.backupDriverId) return null
  const promotedId = queue.backupDriverId
  const opened = Date.parse(now)
  const next = strike({
    ...queue,
    primaryDriverId: promotedId,
    backupDriverId: null,
    promotedFromBackup: true,
    confirmState: 'window_open',
    urgent: true,
    confirmedAt: null,
    navigateStartedAt: null,
    leaveNowAt: null,
    movementDetectedAt: null,
    riderNotifiedEnrouteAt: null,
    riderNotice: null,
    windowOpensAt: now,
    windowClosesAt: new Date(opened + BACKUP_CONFIRM_WINDOW_MS).toISOString(),
    windowNotifiedAt: null,
    lastFix: null,
    backupStoodBy: true,
    backupOfflineDuringWindow: false,
  }, queue.primaryDriverId, reason, now)
  return withEvent(next, {
    kind: 'backup_promoted',
    at: now,
    driverId: promotedId,
    reason,
  })
}

export function handToUrgentPool(queue, { reason, now = new Date().toISOString() }) {
  const next = strike({
    ...queue,
    primaryDriverId: null,
    backupDriverId: null,
    confirmState: 'handed_to_pool',
    urgent: true,
    confirmedAt: null,
    navigateStartedAt: null,
    leaveNowAt: null,
    movementDetectedAt: null,
    riderNotifiedEnrouteAt: null,
    riderNotice: null,
  }, queue.primaryDriverId, reason, now)
  return withEvent(next, { kind: 'urgent_pool', at: now, reason })
}

/**
 * The live before-pickup switch closes the backup arrangement.
 * Cancel releases both drivers. A switch to the backup makes that driver
 * the primary and clears the second seat. Any other new match releases
 * the backup. Nobody is struck; the rider asked for the change.
 */
export function backupQueueAfterRiderSwitch(queue, { action, nextDriverId = null, now = new Date().toISOString() } = {}) {
  if (!queue?.enabled || queue.confirmState === 'released') return queue || null
  const ending = action === 'cancel' || action === 'open-carpool'
  const formerBackupId = queue.backupDriverId || null
  const formerPrimaryId = queue.primaryDriverId || null
  const reassignBackup = !ending && Boolean(formerBackupId) && nextDriverId === formerBackupId
  const nextPrimary = ending ? null : (reassignBackup ? formerBackupId : (nextDriverId || null))
  const releasedDriverIds = [formerPrimaryId, formerBackupId].filter((id) => id && id !== nextPrimary)
  const cleared = {
    ...queue,
    primaryDriverId: nextPrimary,
    backupDriverId: null,
    primaryCard: reassignBackup ? (queue.backupCard || null) : null,
    backupCard: null,
    confirmState: 'released',
    confirmedAt: null,
    navigateStartedAt: null,
    leaveNowAt: null,
    movementDetectedAt: null,
    riderNotifiedEnrouteAt: null,
    riderNotice: null,
    windowOpensAt: null,
    windowClosesAt: null,
    windowNotifiedAt: null,
    urgent: false,
    releasedAt: now,
    releasedReason: action,
    releasedDriverIds,
  }
  return withEvent(cleared, {
    kind: ending ? 'rider_cancel_release' : (reassignBackup ? 'backup_reassigned' : 'backup_released'),
    at: now,
    action,
    formerPrimaryId,
    formerBackupId,
    nextDriverId: nextPrimary,
  })
}

export function releaseActiveDriver(queue, { reason, now }) {
  if (queue?.backupDriverId) return { action: 'promote', queue: promoteBackup(queue, { reason, now }) }
  return { action: 'pool', queue: handToUrgentPool(queue, { reason, now }) }
}

export function driverHasStartedTowardPickup(queue) {
  if (!queue) return false
  return queue.confirmState === 'enroute' || Boolean(queue.navigateStartedAt) || Boolean(queue.movementDetectedAt)
}

function tripAlreadyRolling(trip) {
  return ['arriving', 'arrived', 'in_progress'].includes(trip?.status)
}

export function departureBlocksSwitch(trip, queue, safetyReport) {
  const moving = driverHasStartedTowardPickup(queue) || tripAlreadyRolling(trip)
  if (!moving) return false
  if (safetyReport && SWITCH_AFTER_DEPARTURE_REQUIRES_SAFETY) return false
  return true
}

export function switchDecision(trip, queue, { safetyReport = false } = {}) {
  if (!queue?.enabled) return { ok: false, code: 'backup_not_enabled' }
  if (!queue.primaryDriverId || !queue.backupDriverId) return { ok: false, code: 'backup_not_filled' }
  if ((queue.switchCount || 0) >= BACKUP_SWITCH_LIMIT) return { ok: false, code: 'switch_limit' }
  if (departureBlocksSwitch(trip, queue, safetyReport)) return { ok: false, code: 'already_enroute' }
  return { ok: true }
}

/**
 * Rider prefers the backup. The two drivers swap. The backup fee is paid once,
 * to the former primary, and is not also a standby bonus.
 */
export function swapBackupDrivers(trip, queue, { now = new Date().toISOString(), safetyReport = false } = {}) {
  const decision = switchDecision(trip, queue, { safetyReport })
  if (!decision.ok) return decision
  const formerPrimaryId = queue.primaryDriverId
  const newPrimaryId = queue.backupDriverId
  const moving = driverHasStartedTowardPickup(queue) || tripAlreadyRolling(trip)
  const opened = Date.parse(now)
  const freshWindow = moving || queue.confirmState === 'window_open'
  const next = withEvent({
    ...queue,
    primaryDriverId: newPrimaryId,
    backupDriverId: formerPrimaryId,
    primaryCard: queue.backupCard || null,
    backupCard: queue.primaryCard || null,
    switchCount: (queue.switchCount || 0) + 1,
    switchedAt: now,
    switchFeeDriverId: formerPrimaryId,
    switchFeeCents: queue.bonusCents,
    backupBonusRedirected: true,
    backupStoodBy: SECOND_BACKUP_BONUS_AFTER_SWITCH,
    promotedFromBackup: false,
    confirmState: freshWindow ? 'window_open' : 'idle',
    confirmedAt: null,
    navigateStartedAt: null,
    leaveNowAt: null,
    movementDetectedAt: null,
    riderNotifiedEnrouteAt: null,
    riderNotice: null,
    windowOpensAt: freshWindow ? now : null,
    windowClosesAt: freshWindow ? new Date(opened + BACKUP_CONFIRM_WINDOW_MS).toISOString() : null,
    windowNotifiedAt: freshWindow ? now : null,
    lastFix: null,
    urgent: false,
    driverNotices: {
      ...(queue.driverNotices || {}),
      [newPrimaryId]: {
        title: "You're the driver",
        body: "You're now the driver for this trip. You'll confirm before pickup and complete the ride.",
        at: now,
      },
      [formerPrimaryId]: {
        title: "You're the backup",
        body: "You're #2 for this trip. Pickup time is unchanged.",
        at: now,
      },
    },
  }, {
    kind: 'rider_switch',
    at: now,
    formerPrimaryId,
    newPrimaryId,
    feeCents: queue.bonusCents,
    feeLabel: SWITCH_FEE_LABEL,
    safetyReport: Boolean(safetyReport),
  })
  return { ok: true, queue: next, formerPrimaryId, newPrimaryId, feeCents: queue.bonusCents }
}

/**
 * Capture only the backup fee. Boost stays on the released remainder when
 * REFUND_BOOST_ON_RIDER_CANCEL is set. No backup booking uses the existing cancel.
 */
export function riderCancelCapture(trip) {
  const queue = readBackupQueue(trip)
  if (!queue) {
    return {
      existingPolicy: true,
      cents: CANCEL_FEE_WITHOUT_BACKUP ? 0 : 0,
      feeDriverId: null,
      boostCents: 0,
      backupPayoutCents: 0,
    }
  }
  const payee = queue.switchFeeDriverId || queue.primaryDriverId || null
  const cents = payee ? queue.bonusCents : 0
  return {
    existingPolicy: false,
    cents,
    feeDriverId: payee,
    feeLabel: queue.switchFeeDriverId ? SWITCH_FEE_LABEL : CANCEL_FEE_LABEL,
    boostCents: REFUND_BOOST_ON_RIDER_CANCEL ? readScheduledBoostCents(trip?.metadata) : 0,
    boostRefunded: REFUND_BOOST_ON_RIDER_CANCEL,
    backupPayoutCents: BACKUP_PAID_ON_RIDER_CANCEL ? queue.bonusCents : 0,
    releaseRemainder: true,
  }
}

export function riderSwitchCopy(backupName, feeCents, formerName) {
  const fee = `$${Math.round((feeCents || 0) / 100)}`
  const next = backupName || 'the backup driver'
  const previous = formerName || 'your current driver'
  return `Switch to ${next}? The drivers swap places. ${previous} gets the ${fee} as a switch fee. You can switch once. A switch never counts as a strike.`
}

export function riderCancelCopy(primaryName, feeCents) {
  const fee = `$${Math.round((feeCents || 0) / 100)}`
  const name = primaryName || 'Your driver'
  return `Cancel this ride? ${name} gets the ${fee} as a cancellation fee. The second driver gets nothing. Any boost is given back. The rest of the hold on your card is released.`
}

/**
 * Payout split. Fare net is the existing driver share. Boost is added when the
 * scheduled-boost metadata is present. The backup bonus never goes to a
 * primary who flaked.
 *
 * JOHN: unused backup still earns the bonus when backupStoodBy is true.
 */
export function splitBackupPayout({ fareNetCents = 0, boostCents = 0, bonusCents = 0, promoted = false, backupStoodBy = true } = {}) {
  const fare = Math.max(0, Math.round(Number(fareNetCents) || 0))
  const boost = Math.max(0, Math.round(Number(boostCents) || 0))
  const bonus = Math.max(0, Math.round(Number(bonusCents) || 0))
  if (promoted) {
    return {
      completingDriverCents: fare + boost + bonus,
      standbyCents: 0,
      flakedPrimaryCents: 0,
      strike: true,
    }
  }
  return {
    completingDriverCents: fare + boost,
    standbyCents: backupStoodBy ? bonus : 0,
    flakedPrimaryCents: 0,
    strike: false,
  }
}

export function payoutPlanForTrip(trip, fareNetCents) {
  const queue = readBackupQueue(trip)
  if (!queue) return null
  const split = splitBackupPayout({
    fareNetCents,
    boostCents: readScheduledBoostCents(trip?.metadata),
    bonusCents: queue.bonusCents,
    promoted: queue.promotedFromBackup === true,
    backupStoodBy: queue.backupBonusRedirected
      ? SECOND_BACKUP_BONUS_AFTER_SWITCH
      : queue.backupStoodBy !== false && !queue.backupOfflineDuringWindow,
  })
  return {
    ...split,
    completingDriverId: trip?.driver_id || queue.primaryDriverId || null,
    standbyDriverId: queue.promotedFromBackup ? null : queue.backupDriverId,
    flakedDriverId: queue.flakedDriverId || null,
  }
}

/** Extra cents added on top of the existing fare-net for the driver who completed the trip. */
export function completingPayoutExtraCents(trip) {
  const queue = readBackupQueue(trip)
  if (!queue) return 0
  const boost = readScheduledBoostCents(trip?.metadata)
  if (queue.promotedFromBackup) return boost + queue.bonusCents
  return boost
}

export function standbyPayoutCents(trip) {
  const plan = payoutPlanForTrip(trip, 0)
  if (!plan?.standbyDriverId) return 0
  return plan.standbyCents
}

export function switchFeePayoutForTrip(trip) {
  const queue = readBackupQueue(trip)
  if (!queue?.backupBonusRedirected || !queue.switchFeeDriverId || !queue.switchFeeCents) return null
  if (queue.cancelSettledAt) return null
  return {
    driverId: queue.switchFeeDriverId,
    cents: queue.switchFeeCents,
    label: SWITCH_FEE_LABEL,
    role: 'switch_fee',
  }
}

export function earningsExtrasForDriver(trip, driverId) {
  const queue = readBackupQueue(trip)
  if (!queue || !driverId) return { cents: 0, parts: [] }
  const parts = []
  let cents = 0
  const promoted = queue.promotedFromBackup === true
  if (trip?.driver_id === driverId && promoted) {
    cents += queue.bonusCents
    parts.push({ label: 'Backup bonus', cents: queue.bonusCents })
  }
  if (!promoted && !queue.backupBonusRedirected && queue.backupDriverId === driverId && queue.backupStoodBy !== false && !queue.backupOfflineDuringWindow) {
    cents += queue.bonusCents
    parts.push({ label: 'Backup standby', cents: queue.bonusCents })
  }
  if (queue.switchFeeDriverId === driverId && queue.switchFeeCents && queue.backupBonusRedirected) {
    cents += queue.switchFeeCents
    parts.push({ label: SWITCH_FEE_LABEL, cents: queue.switchFeeCents })
  }
  if (trip?.status === 'canceled' && queue.cancelFeeDriverId === driverId && queue.cancelFeeCents) {
    cents += queue.cancelFeeCents
    parts.push({ label: CANCEL_FEE_LABEL, cents: queue.cancelFeeCents })
  }
  return { cents, parts }
}

export function riderBackupPresentation(trip) {
  const queue = readBackupQueue(trip)
  if (!queue || queue.confirmState === 'released') return null
  let status = 'Backup requested'
  if (queue.confirmState === 'handed_to_pool') status = URGENT_POOL_LABEL
  else if (queue.confirmState === 'enroute') status = 'Your driver is on the way'
  else if (queue.primaryDriverId && queue.backupDriverId) status = DRIVER_AND_BACKUP_LABEL
  else if (queue.primaryDriverId) status = LOOKING_FOR_BACKUP_LABEL
  const decision = switchDecision(trip, queue)
  const primaryName = queue.primaryCard?.name || null
  const backupName = queue.backupCard?.name || null
  const safetyAllowed = decision.code === 'already_enroute'
    && SWITCH_AFTER_DEPARTURE_REQUIRES_SAFETY
    && Boolean(queue.primaryDriverId && queue.backupDriverId)
    && (queue.switchCount || 0) < BACKUP_SWITCH_LIMIT
  return {
    status,
    bonusCents: queue.bonusCents,
    bonusLabel: backupBonusLabel(queue.bonusCents),
    notice: queue.riderNotice?.body || null,
    urgent: queue.urgent === true,
    primary: queue.primaryCard,
    backup: queue.backupCard,
    canSwitch: decision.ok,
    switchCode: decision.ok ? null : decision.code,
    canSafetySwitch: safetyAllowed,
    switchCopy: riderSwitchCopy(backupName, queue.bonusCents, primaryName),
    cancelCopy: queue.primaryDriverId || queue.switchFeeDriverId
      ? riderCancelCopy(primaryName, queue.bonusCents)
      : 'Cancel this ride? No driver has accepted yet, so the hold on your card is released and the backup fee is not charged.',
    feeCents: queue.bonusCents,
    switchesUsed: queue.switchCount || 0,
  }
}

export function driverBackupPresentation(trip, driverId) {
  const queue = readBackupQueue(trip)
  if (!queue || queue.confirmState === 'released') return null
  const role = queue.primaryDriverId === driverId
    ? 'primary'
    : queue.backupDriverId === driverId
      ? 'backup'
      : !queue.primaryDriverId
        ? 'open_primary'
        : !queue.backupDriverId
          ? 'open_backup'
          : 'full'
  const confirmed = Boolean(queue.confirmedAt)
  const confirmOpen = queue.confirmState === 'window_open' && role === 'primary' && !confirmed
  const leaveNowOpen = queue.confirmState === 'window_open' && role === 'primary' && confirmed && !queue.navigateStartedAt && Boolean(queue.leaveNowAt)
  return {
    role,
    bonusCents: queue.bonusCents,
    bonusLabel: backupBonusLabel(queue.bonusCents),
    lookingForBackup: lookingForBackup(trip),
    queueLabel: lookingForBackup(trip) ? LOOKING_FOR_BACKUP_LABEL : null,
    confirmOpen,
    confirmClosesAt: confirmOpen ? queue.windowClosesAt : null,
    confirmCopy: confirmOpen ? CONFIRM_TRIP_COPY : null,
    leaveNowAt: leaveNowOpen ? queue.leaveNowAt : null,
    leaveNowOpen,
    enroute: queue.confirmState === 'enroute' && role === 'primary',
    urgent: queue.urgent === true && role === 'primary',
    backupSeatCopy: role === 'backup',
    notice: queue.driverNotices?.[driverId]?.body || null,
    statusLine: role === 'backup'
      ? 'You\'re #2 for this trip'
      : role === 'primary' && queue.urgent
        ? 'You\'re up. Confirm this trip and start toward pickup.'
        : role === 'primary'
          ? 'You\'re the driver for this trip'
          : LOOKING_FOR_BACKUP_LABEL,
  }
}

export function backupNumberTwoCopy(pickupLabel) {
  const when = pickupLabel || 'the scheduled time'
  return `You're #2 for this trip, pickup at ${when}`
}
