/**
 * Plain-language boost copy for riders and drivers.
 * A central How it works screen can import this module.
 * Dollar amounts follow the presets and cap in shared/scheduledBoost.js.
 *
 * John: the driver line says the boost is all theirs while
 * BOOST_DRIVER_SHARE_BPS is 10000. Change that sentence if the split changes.
 */
import {
  BOOST_DRIVER_SHARE_BPS,
  BOOST_MAX_CENTS,
  BOOST_NUDGE_LEAD_MS,
  BOOST_PRESETS_CENTS,
  boostIsEditable,
  formatBoostDollars,
  readBoostCents,
} from '../scheduledBoost.js'

export const BOOST_RIDER_HELPER = 'Add a boost to get a driver sooner. Your driver keeps all of it.'

export const BOOST_SHEET_TITLE = 'How a boost works'

export const BOOST_SHEET_INTRO = 'A boost is extra money you add so a driver wants to take your scheduled ride.'

export const BOOST_INFO_LABEL = 'How a boost works'

export const BOOST_NUDGE_ADD = 'No driver yet. Add a boost to get a driver sooner. Your driver keeps all of it.'

export const BOOST_NUDGE_RAISE = 'No driver yet. Raise the boost to get a driver sooner. Your driver keeps all of it.'

/** Shown under the picker on the schedule screen. */
export const BOOST_SCHEDULE_NOTE = 'You are not charged when you confirm. About 45 minutes before pickup, we place a hold on your card. The boost is part of that hold. You are charged when the ride ends.'

function presetList() {
  const amounts = BOOST_PRESETS_CENTS.map((cents) => formatBoostDollars(cents))
  if (amounts.length <= 1) return amounts[0] || ''
  if (amounts.length === 2) return `${amounts[0]} or ${amounts[1]}`
  return `${amounts.slice(0, -1).join(', ')}, or ${amounts[amounts.length - 1]}`
}

function driverKeepsStep() {
  if (BOOST_DRIVER_SHARE_BPS >= 10000) {
    return 'Your driver keeps all of it. We do not take a cut.'
  }
  const pct = Math.round(BOOST_DRIVER_SHARE_BPS / 100)
  return `Your driver keeps ${pct}% of the boost.`
}

/** Numbered steps for the rider info sheet and any How it works screen. */
export function boostHowItWorks() {
  return {
    title: BOOST_SHEET_TITLE,
    intro: BOOST_SHEET_INTRO,
    infoLabel: BOOST_INFO_LABEL,
    steps: [
      `Pick ${presetList()}. Or type your own amount, up to ${formatBoostDollars(BOOST_MAX_CENTS)}.`,
      driverKeepsStep(),
      'The boost is added to the hold on your card. You are charged when the ride ends.',
      'You can raise the boost until a driver accepts.',
      'If you cancel, the boost is refunded.',
    ],
  }
}

/** Short line under the picker once an amount is chosen. */
export function riderBoostChosenLine(cents) {
  return `Boost ${formatBoostDollars(cents)}. Your driver keeps all of it.`
}

/**
 * One line under the orange boost badge.
 * `cents` is what the driver receives. At a 100% split that is the rider's boost.
 */
export function driverBoostOfferLine(cents) {
  const amount = formatBoostDollars(cents)
  if (BOOST_DRIVER_SHARE_BPS >= 10000) {
    return `The rider added ${amount} to get this ride accepted. It's all yours.`
  }
  return `The rider added a boost to get this ride accepted. ${amount} is yours.`
}

/**
 * Gentle in-app nudge. Null when a driver is assigned, the pickup is not
 * inside the lead window, or the ride is not still open.
 */
export function boostNudge(trip, now = new Date()) {
  if (!boostIsEditable(trip)) return null
  const when = trip.pickup_at || trip.scheduled_for || trip.pickupAt || trip.metadata?.scheduled_pickup_at
  if (!when) return null
  const until = new Date(when).getTime() - (now instanceof Date ? now.getTime() : new Date(now).getTime())
  if (!Number.isFinite(until) || until <= 0 || until > BOOST_NUDGE_LEAD_MS) return null
  const boost = readBoostCents(trip)
  if (boost > 0) return { id: 'bump', body: BOOST_NUDGE_RAISE }
  return { id: 'add', body: BOOST_NUDGE_ADD }
}
