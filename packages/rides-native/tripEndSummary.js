/**
 * Driver trip-end summary, rider rating tags, and the "Back in queue" state.
 * Pure helpers so the driver app and tests share the same copy and numbers.
 * Net always equals DriverCard.driverNetCents (shared/driverTripEarnings.js).
 */
import { formatCents } from './tripTags.js'

const cents = (value) => Math.max(0, Math.round(Number(value) || 0))

/**
 * Lines for the completed-trip summary card.
 * Tip is shown on its own line: it is charged after the trip and is not in this payout.
 */
export function tripEndSummary(card) {
  const earnings = card?.earnings && card.earnings.kind === 'trip' ? card.earnings : null
  const fareCents = cents(earnings?.fareCents ?? card?.fareCents)
  const riderWaitFeeCents = cents(earnings?.riderWaitFeeCents ?? card?.waitFeeCents)
  const waitCents = cents(earnings?.waitCents ?? card?.driverWaitEarningsCents)
  const netCents = cents(card?.driverNetCents)
  const lines = [{ key: 'fare', label: 'Trip fare', value: formatCents(fareCents) }]
  if (earnings && earnings.platformFeeCents > 0) {
    lines.push({ key: 'fee', label: 'Platform fee', value: `−${formatCents(earnings.platformFeeCents)}` })
  }
  if (earnings && earnings.tigerHeatBonusCents > 0) {
    lines.push({ key: 'heat', label: 'Tiger Heat bonus', value: `+${formatCents(earnings.tigerHeatBonusCents)}` })
  }
  if (riderWaitFeeCents > 0 || waitCents > 0) {
    lines.push({
      key: 'wait',
      label: 'Wait fee',
      value: `+${formatCents(waitCents)}`,
      note: riderWaitFeeCents > 0 ? `Rider paid ${formatCents(riderWaitFeeCents)}` : null,
    })
  }
  if (earnings && earnings.boostCents > 0) {
    lines.push({ key: 'boost', label: 'Boost · your share', value: `+${formatCents(earnings.boostCents)}` })
  }
  if (earnings && earnings.backupBonusCents > 0) {
    lines.push({ key: 'backup', label: 'Backup bonus', value: `+${formatCents(earnings.backupBonusCents)}` })
  }
  const tipCents = cents(card?.tipCents ?? earnings?.tipCents)
  const tip = tipCents > 0
    ? { label: 'Tip', value: `+${formatCents(tipCents)}`, note: 'Paid to you separately', pending: false }
    : { label: 'Tip', value: 'Pending', note: 'The rider can still add a tip', pending: true }
  return {
    title: 'Trip complete',
    lines,
    net: { label: 'Net earnings', value: formatCents(netCents), cents: netCents },
    tip,
    payoutLine: card?.payoutStatusLine || 'Payout is on the way.',
    accessibilityLabel: `Trip complete. Net earnings ${formatCents(netCents)}. Tip ${tip.value}.`,
  }
}

export const POSITIVE_RATING_TAGS = Object.freeze(['On time', 'Friendly', 'Respectful', 'Clean', 'Good directions'])
export const ISSUE_RATING_TAGS = Object.freeze(['Late', 'Rude', 'Messy', 'Wrong pickup spot'])
export const RATING_TAGS = Object.freeze([...POSITIVE_RATING_TAGS, ...ISSUE_RATING_TAGS])
export const MAX_RATING_TAGS = 5

/** 4–5 stars show compliments, 1–3 stars show issues. */
export function ratingTagOptions(stars) {
  const n = Math.round(Number(stars) || 0)
  return n >= 4 ? [...POSITIVE_RATING_TAGS] : [...ISSUE_RATING_TAGS]
}

/** Keep only tags valid for the chosen stars, deduped, capped. */
export function normalizeRatingTags(tags, stars) {
  const allowed = new Set(ratingTagOptions(stars))
  const out = []
  for (const tag of Array.isArray(tags) ? tags : []) {
    const value = String(tag || '').trim()
    if (allowed.has(value) && !out.includes(value)) out.push(value)
    if (out.length >= MAX_RATING_TAGS) break
  }
  return out
}

export function toggleRatingTag(tags, tag, stars) {
  const list = normalizeRatingTags(tags, stars)
  return list.includes(tag) ? list.filter((t) => t !== tag) : normalizeRatingTags([...list, tag], stars)
}

/** Copy for the state shown after the summary and rating. */
export function backInQueueCopy(online) {
  if (online) {
    return {
      kicker: 'BACK IN QUEUE',
      title: "You're online",
      body: 'New ride offers nearby will show up here and as alerts.',
      primary: 'See offers',
      secondary: 'Go offline',
    }
  }
  return {
    kicker: 'TRIP DONE',
    title: "You're offline",
    body: 'Go online to get the next ride offer.',
    primary: 'Go online',
    secondary: 'Home',
  }
}
