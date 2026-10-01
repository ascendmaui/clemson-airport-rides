/**
 * Canonical rating and feedback terminology, labels, and tag helpers.
 * Shared across Vite web and Expo mobile apps (rider and driver).
 */

/** Star rating descriptive labels (1-5) */
export const STAR_DESCRIPTORS = Object.freeze({
  1: 'Poor',
  2: 'Below average',
  3: 'OK',
  4: 'Good',
  5: 'Excellent',
})

/**
 * Returns user-facing descriptive label for star rating count.
 * @param {unknown} stars
 * @returns {string}
 */
export function getStarDescriptor(stars) {
  const n = Math.round(Number(stars) || 0)
  return STAR_DESCRIPTORS[n] || ''
}

/** Standard positive compliments when rating 4 or 5 stars */
export const RIDER_COMPLIMENTS = Object.freeze([
  Object.freeze({ id: 'smooth_driving', label: 'Smooth driving', icon: 'car' }),
  Object.freeze({ id: 'clean_car', label: 'Clean vehicle', icon: 'sparkles' }),
  Object.freeze({ id: 'safe_driving', label: 'Safe driving', icon: 'shield' }),
  Object.freeze({ id: 'on_time', label: 'On time pickup', icon: 'clock' }),
  Object.freeze({ id: 'great_conversation', label: 'Great conversation', icon: 'chat' }),
  Object.freeze({ id: 'quiet_ride', label: 'Quiet ride', icon: 'volume-x' }),
  Object.freeze({ id: 'great_music', label: 'Great music', icon: 'music' }),
])

export const DRIVER_COMPLIMENTS = Object.freeze([
  Object.freeze({ id: 'ready_on_time', label: 'Ready at curb', icon: 'clock' }),
  Object.freeze({ id: 'polite_respectful', label: 'Polite & respectful', icon: 'smile' }),
  Object.freeze({ id: 'clean_passenger', label: 'Kept car clean', icon: 'sparkles' }),
  Object.freeze({ id: 'easy_pickup', label: 'Clear pickup spot', icon: 'map-pin' }),
  Object.freeze({ id: 'friendly', label: 'Friendly rider', icon: 'heart' }),
])

/** Standard constructive feedback tags when rating 1, 2, or 3 stars */
export const RIDER_IMPROVEMENT_TAGS = Object.freeze([
  Object.freeze({ id: 'driving_safety', label: 'Driving safety' }),
  Object.freeze({ id: 'cleanliness', label: 'Vehicle cleanliness' }),
  Object.freeze({ id: 'navigation', label: 'Navigation / route' }),
  Object.freeze({ id: 'pickup_delay', label: 'Long wait / delay' }),
  Object.freeze({ id: 'professionalism', label: 'Professionalism' }),
])

export const DRIVER_IMPROVEMENT_TAGS = Object.freeze([
  Object.freeze({ id: 'rider_late', label: 'Made driver wait' }),
  Object.freeze({ id: 'difficult_pickup', label: 'Inaccessible pickup spot' }),
  Object.freeze({ id: 'disrespectful', label: 'Disrespectful behavior' }),
  Object.freeze({ id: 'messy', label: 'Left a mess in vehicle' }),
])

/**
 * Returns available feedback tag options based on role and rating level.
 * @param {'rider' | 'driver'} role The role of the person leaving the rating
 * @param {number} stars Rating score (1-5)
 */
export function getFeedbackTagsForRating(role = 'rider', stars = 5) {
  const isPositive = Number(stars) >= 4
  if (role === 'rider') {
    return isPositive ? RIDER_COMPLIMENTS : RIDER_IMPROVEMENT_TAGS
  }
  return isPositive ? DRIVER_COMPLIMENTS : DRIVER_IMPROVEMENT_TAGS
}

/**
 * Formats a rating score and count into consistent, accessible presentation strings.
 * @param {unknown} avg Average rating number (e.g. 4.85)
 * @param {unknown} count Total count of received ratings
 * @param {{ style?: 'compact' | 'full' | 'card' | 'accessible', role?: 'rider' | 'driver' }} [options]
 */
export function formatRatingDisplay(avg, count, { style = 'compact', role = 'rider' } = {}) {
  const n = Math.max(0, Math.round(Number(count) || 0))
  const numAvg = avg != null && Number.isFinite(Number(avg)) ? Number(avg) : null

  if (!n || numAvg == null) {
    switch (style) {
      case 'card':
        return role === 'driver' ? 'New driver' : 'New rider'
      case 'full':
        return 'New · no ratings yet'
      case 'accessible':
        return role === 'driver' ? 'New driver with no ratings yet' : 'New rider with no ratings yet'
      case 'compact':
      default:
        return 'New'
    }
  }

  const formattedAvg = (Math.round(numAvg * 10) / 10).toFixed(1)
  const countLabel = n === 1 ? 'rating' : 'ratings'

  switch (style) {
    case 'full':
      return `${formattedAvg} ★ (${n} ${countLabel})`
    case 'card':
      return `★ ${formattedAvg} (${n})`
    case 'accessible':
      return `${formattedAvg} stars across ${n} ${countLabel}`
    case 'compact':
    default:
      return `★ ${formattedAvg}`
  }
}

/** Standing labels and tone configuration */
export const STANDING_COPY = Object.freeze({
  good: Object.freeze({
    label: 'Good standing',
    badgeText: 'Good',
    tone: 'neutral',
    hint: 'Account in good standing with community ratings.',
  }),
  watch: Object.freeze({
    label: 'Low rating',
    badgeText: 'Low rating',
    tone: 'warn',
    hint: 'Average below 3.0 after multiple ratings.',
  }),
  restricted: Object.freeze({
    label: 'Account restricted',
    badgeText: 'Restricted',
    tone: 'danger',
    hint: 'Average below 2.5 after 5 or more ratings. Dispatch is restricted.',
  }),
})

/**
 * Returns normalized standing badge copy and display tone.
 * @param {unknown} standing
 */
export function formatStandingBadge(standing) {
  const key = String(standing || '').trim().toLowerCase()
  return STANDING_COPY[key] || STANDING_COPY.good
}

export const RATING_SUBMISSION_TITLE = 'Thanks for your feedback'
export const RATING_SUBMISSION_NOTE = 'Ratings help keep the Clemson community safe and reliable for everyone.'
export const RATING_ALREADY_SUBMITTED_TITLE = 'Already rated'
export const RATING_ALREADY_SUBMITTED_NOTE = 'You have already submitted a rating for this trip.'
