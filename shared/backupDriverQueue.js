/**
 * Backup-driver queue for scheduled rides.
 * Two drivers deep: a primary and one backup. Pure rules live here so the
 * dispatch tick, payouts, and both rider/driver clients share one definition.
 *
 * JOHN — confirm these defaults before they ship to drivers:
 * 1. Window opens at pickup − drive time − 10 min, clamped to 20–60 min before
 *    pickup. The driver then has 5 minutes to confirm and start toward pickup.
 * 2. If the backup is never needed, they still receive the bonus when they
 *    stayed available through the window (offline during the window forfeits it).
 * 3. A primary who misses the window or cancels early gets a reliability strike
 *    and no payout. Early-cancel strikes are included; say if those should differ
 *    from a missed confirm.
 * 4. With no backup, the ride reopens to the live pool marked urgent and the
 *    rider and admin are notified. No automatic refund.
 * 5. Rider cancel does not auto-refund the backup fee. The hold is captured
 *    only when the trip completes.
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
export const RIDER_ENROUTE_COPY = 'Your driver is on the way, everything is going as planned, sit tight.'
export const URGENT_POOL_LABEL = 'Urgent — needs a driver'
export const BOOK_BACKUP_COPY = 'Book a backup driver for an additional $10 or $15'

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
  }
}

export function isBackupQueueRide(trip) {
  return Boolean(readBackupQueue(trip))
}

export function backupSlotOpen(trip) {
  const queue = readBackupQueue(trip)
  if (!queue) return false
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
  if (!queue) return fare
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
    movementDetectedAt: null,
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
    movementDetectedAt: null,
  }, queue.primaryDriverId, reason, now)
  return withEvent(next, { kind: 'urgent_pool', at: now, reason })
}

export function releaseActiveDriver(queue, { reason, now }) {
  if (queue?.backupDriverId) return { action: 'promote', queue: promoteBackup(queue, { reason, now }) }
  return { action: 'pool', queue: handToUrgentPool(queue, { reason, now }) }
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
    backupStoodBy: queue.backupStoodBy !== false && !queue.backupOfflineDuringWindow,
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

export function earningsExtrasForDriver(trip, driverId) {
  const queue = readBackupQueue(trip)
  if (!queue || !driverId) return { cents: 0, parts: [] }
  const promoted = queue.promotedFromBackup === true
  if (trip?.driver_id === driverId && promoted) {
    return { cents: queue.bonusCents, parts: [{ label: 'Backup bonus', cents: queue.bonusCents }] }
  }
  if (!promoted && queue.backupDriverId === driverId && queue.backupStoodBy !== false && !queue.backupOfflineDuringWindow) {
    return { cents: queue.bonusCents, parts: [{ label: 'Backup standby', cents: queue.bonusCents }] }
  }
  return { cents: 0, parts: [] }
}

export function riderBackupPresentation(trip) {
  const queue = readBackupQueue(trip)
  if (!queue) return null
  let status = 'Backup requested'
  if (queue.confirmState === 'handed_to_pool') status = URGENT_POOL_LABEL
  else if (queue.confirmState === 'enroute') status = 'Your driver is on the way'
  else if (queue.primaryDriverId && queue.backupDriverId) status = DRIVER_AND_BACKUP_LABEL
  else if (queue.primaryDriverId) status = LOOKING_FOR_BACKUP_LABEL
  return {
    status,
    bonusCents: queue.bonusCents,
    bonusLabel: backupBonusLabel(queue.bonusCents),
    notice: queue.riderNotice?.body || null,
    urgent: queue.urgent === true,
  }
}

export function driverBackupPresentation(trip, driverId) {
  const queue = readBackupQueue(trip)
  if (!queue) return null
  const role = queue.primaryDriverId === driverId
    ? 'primary'
    : queue.backupDriverId === driverId
      ? 'backup'
      : !queue.primaryDriverId
        ? 'open_primary'
        : !queue.backupDriverId
          ? 'open_backup'
          : 'full'
  const confirmOpen = queue.confirmState === 'window_open' && role === 'primary'
  return {
    role,
    bonusCents: queue.bonusCents,
    bonusLabel: backupBonusLabel(queue.bonusCents),
    lookingForBackup: lookingForBackup(trip),
    queueLabel: lookingForBackup(trip) ? LOOKING_FOR_BACKUP_LABEL : null,
    confirmOpen,
    confirmClosesAt: confirmOpen ? queue.windowClosesAt : null,
    confirmCopy: confirmOpen ? CONFIRM_TRIP_COPY : null,
    urgent: queue.urgent === true && role === 'primary',
    backupSeatCopy: role === 'backup',
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
