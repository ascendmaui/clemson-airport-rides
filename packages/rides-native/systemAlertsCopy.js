/**
 * Standardized system alerts, notification preferences, and toast copy across mobile & web.
 */

export const ALERT_LEVELS = Object.freeze({
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
})

export const DND_COPY = Object.freeze({
  TITLE: 'Do not disturb — new requests',
  DESCRIPTION: 'Mutes the new-request tone. Mid-ride cancel tones still play.',
})

export const QUIET_HOURS_COPY = Object.freeze({
  TITLE: 'Quiet hours',
  DESCRIPTION: 'Automatically silence ride request tones during scheduled hours.',
})

export const SYNC_STATUS_COPY = Object.freeze({
  SAVED_TO_ACCOUNT: 'Saved to your account.',
  SAVED_ON_PHONE: 'Saved on this phone.',
  SAVED_ON_DEVICE: 'Saved on this device.',
})

/**
 * Returns formatted sync feedback message.
 * @param {boolean} persisted
 * @param {string|null} [softFail]
 * @param {boolean} [isMobile]
 * @returns {string}
 */
export function formatSyncFeedback(persisted, softFail = null, isMobile = false) {
  const localLabel = isMobile ? SYNC_STATUS_COPY.SAVED_ON_PHONE : SYNC_STATUS_COPY.SAVED_ON_DEVICE
  if (softFail) {
    return `${localLabel} Profile sync: ${softFail}`
  }
  if (persisted) {
    return SYNC_STATUS_COPY.SAVED_TO_ACCOUNT
  }
  return localLabel
}

/**
 * System alert definitions for all in-app toasts, mobile push, and notification streams.
 */
export const SYSTEM_ALERT_KINDS = Object.freeze({
  ride_requested: {
    title: 'Ride requested',
    defaultBody: 'Looking for nearby drivers…',
    category: 'ride',
    level: ALERT_LEVELS.INFO,
    tone: 'orange',
    critical: false,
  },
  ride_scheduled: {
    title: 'Scheduled ride',
    defaultBody: 'Your scheduled airport trip has been saved.',
    category: 'ride',
    level: ALERT_LEVELS.INFO,
    tone: 'orange',
    critical: false,
  },
  ride_reminder: {
    title: 'Pickup reminder',
    defaultBody: 'Your pickup time is approaching.',
    category: 'ride',
    level: ALERT_LEVELS.INFO,
    tone: 'purple',
    critical: false,
  },
  driver_accepted: {
    title: 'Driver accepted',
    defaultBody: 'A driver has accepted your ride request.',
    category: 'ride',
    level: ALERT_LEVELS.SUCCESS,
    tone: 'purple',
    critical: false,
  },
  driver_en_route: {
    title: 'Driver en route',
    defaultBody: 'Your driver is heading to the pickup point.',
    category: 'ride',
    level: ALERT_LEVELS.INFO,
    tone: 'orange',
    critical: false,
  },
  arrived_pickup: {
    title: 'Arrived at pickup',
    defaultBody: 'Your driver has arrived at the pickup location.',
    category: 'ride',
    level: ALERT_LEVELS.SUCCESS,
    tone: 'purple',
    critical: false,
  },
  trip_started: {
    title: 'Trip started',
    defaultBody: 'Your ride is in progress.',
    category: 'ride',
    level: ALERT_LEVELS.INFO,
    tone: 'orange',
    critical: false,
  },
  trip_completed: {
    title: 'Trip completed',
    defaultBody: 'You have arrived at your destination.',
    category: 'ride',
    level: ALERT_LEVELS.SUCCESS,
    tone: 'purple',
    critical: false,
  },
  ride_wait_cancelled: {
    title: 'Ride canceled',
    defaultBody: 'The ride request has timed out or was canceled.',
    category: 'ride',
    level: ALERT_LEVELS.WARNING,
    tone: 'orange',
    critical: false,
  },
  canceled_midride: {
    title: 'Ride canceled mid-trip',
    defaultBody: 'The trip was ended early.',
    category: 'ride',
    level: ALERT_LEVELS.WARNING,
    tone: 'orange',
    critical: true,
  },
  fare_charged: {
    title: 'Fare charged',
    defaultBody: 'Your payment card has been charged.',
    category: 'billing',
    level: ALERT_LEVELS.INFO,
    tone: 'purple',
    critical: false,
  },
  payment_failed: {
    title: 'Payment failed',
    defaultBody: 'Unable to process payment method.',
    category: 'billing',
    level: ALERT_LEVELS.ERROR,
    tone: 'danger',
    critical: true,
  },
  payment_required: {
    title: 'Payment required',
    defaultBody: 'Please add a payment method to continue.',
    category: 'billing',
    level: ALERT_LEVELS.WARNING,
    tone: 'danger',
    critical: true,
  },
  payment_retry: {
    title: 'Retry payment',
    defaultBody: 'Retrying card payment…',
    category: 'billing',
    level: ALERT_LEVELS.WARNING,
    tone: 'orange',
    critical: false,
  },
  friend_joined: {
    title: 'Friend joined',
    defaultBody: 'A friend joined your ride lobby.',
    category: 'friends',
    level: ALERT_LEVELS.INFO,
    tone: 'purple',
    critical: false,
  },
  friend_left: {
    title: 'Friend left',
    defaultBody: 'A participant left the ride lobby.',
    category: 'friends',
    level: ALERT_LEVELS.INFO,
    tone: 'orange',
    critical: false,
  },
  carpool_booked: {
    title: 'Carpool booked',
    defaultBody: 'All riders confirmed and driver assigned.',
    category: 'friends',
    level: ALERT_LEVELS.SUCCESS,
    tone: 'orange',
    critical: false,
  },
  location_shared: {
    title: 'Location shared',
    defaultBody: 'Live trip location shared with contacts.',
    category: 'friends',
    level: ALERT_LEVELS.INFO,
    tone: 'purple',
    critical: false,
  },
  driver_incentive: {
    title: 'Driver incentive',
    defaultBody: 'New campus incentive active.',
    category: 'system',
    level: ALERT_LEVELS.INFO,
    tone: 'orange',
    critical: false,
  },
  ride_lost_found: {
    title: 'Lost & found',
    defaultBody: 'New lost & found update on your ride.',
    category: 'system',
    level: ALERT_LEVELS.INFO,
    tone: 'orange',
    critical: false,
  },
  system: {
    title: 'Update',
    defaultBody: 'Account update notice.',
    category: 'system',
    level: ALERT_LEVELS.INFO,
    tone: 'purple',
    critical: false,
  },
})

/**
 * Returns preference category for a given alert/toast kind.
 * @param {string} [kind]
 * @returns {'ride' | 'billing' | 'friends' | 'promotions' | 'system'}
 */
export function categoryForAlertKind(kind) {
  const k = String(kind || '').trim()
  if (k in SYSTEM_ALERT_KINDS) {
    return SYSTEM_ALERT_KINDS[k].category
  }
  if (k === 'canceled_midride') return 'ride'
  if (/^ride_|^trip_|^driver_|^arrived|^en_route/.test(k)) return 'ride'
  if (/^pay|^fare|^billing|^receipt/.test(k)) return 'billing'
  if (/^friend|^carpool|^location_shared/.test(k)) return 'friends'
  if (k === 'driver_incentive' || k === 'incentive_started') return 'system'
  if (/^promo|^surge|^busy/.test(k)) return 'promotions'
  return 'system'
}

/**
 * Checks whether an alert kind is critical and should bypass mute prefs.
 * @param {string} [kind]
 * @returns {boolean}
 */
export function isCriticalAlert(kind) {
  const k = String(kind || '').trim()
  if (k in SYSTEM_ALERT_KINDS) {
    return Boolean(SYSTEM_ALERT_KINDS[k].critical)
  }
  return k === 'canceled_midride' || k === 'payment_required' || k === 'payment_failed'
}

/**
 * Returns visual tone token for an alert kind.
 * @param {string} [kind]
 * @returns {'orange' | 'purple' | 'danger'}
 */
export function toneForAlertKind(kind) {
  const k = String(kind || '').trim()
  if (k in SYSTEM_ALERT_KINDS) {
    return SYSTEM_ALERT_KINDS[k].tone
  }
  return 'purple'
}

/**
 * Formats a system alert with standardized title, body, accessibility roles, and tone.
 * @param {string} kind
 * @param {{ title?: string, body?: string, level?: string, force?: boolean }} [options]
 * @returns {{
 *   kind: string,
 *   title: string,
 *   body: string,
 *   category: string,
 *   level: string,
 *   tone: string,
 *   critical: boolean,
 *   ariaRole: 'alert' | 'status',
 *   liveRegion: 'assertive' | 'polite'
 * }}
 */
export function formatSystemAlert(kind, options = {}) {
  const meta = SYSTEM_ALERT_KINDS[kind] || SYSTEM_ALERT_KINDS.system
  const level = options.level || meta.level
  const isUrgent = level === ALERT_LEVELS.ERROR || meta.critical === true || options.force === true

  return {
    kind,
    title: options.title || meta.title,
    body: options.body || meta.defaultBody,
    category: meta.category,
    level,
    tone: meta.tone,
    critical: Boolean(meta.critical || options.force),
    ariaRole: isUrgent ? 'alert' : 'status',
    liveRegion: isUrgent ? 'assertive' : 'polite',
  }
}
