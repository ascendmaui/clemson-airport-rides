/**
 * Friday coupon drop for the marketing homepage and the notification cron.
 *
 * Drop hour: 12:00 America/New_York (noon Eastern), every Friday.
 * Vercel cron is UTC, so vercel.json schedules 16:00 UTC (noon EDT) and
 * 17:00 UTC (noon EST). The handler sends only when the New York clock is
 * Friday and the hour is 12, so one of those two invocations is a no-op.
 *
 * These concepts rotate. They are not the standing offers (first-ride 50%,
 * refer-two .edu free ride, two-rides-over-$20, or the $100-for-$75 pack).
 */

export const FRIDAY_DROP_HOUR_ET = 12
export const FRIDAY_DROP_TIME_ZONE = 'America/New_York'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Friday 2 Jan 2026, the index origin for the rotation. */
const EPOCH_FRIDAY = { year: 2026, month: 1, day: 2 }

/**
 * Fresh weekly ideas. percentOffBps and amountOffCents are mutually exclusive.
 * Codes gain a date stamp at drop time so a repeated concept is still a new code.
 */
export const WEEKLY_COUPON_CONCEPTS = [
  {
    id: 'tillman-twilight',
    codePrefix: 'TILLMAN',
    title: 'Tillman twilight',
    detail: '30% off a ride that starts at Tillman Hall after 7:00 PM.',
    percentOffBps: 3000,
    amountOffCents: 0,
  },
  {
    id: 'fike-finish',
    codePrefix: 'FIKE',
    title: 'Fike finish',
    detail: '$5 off a pickup at Fike Recreation.',
    percentOffBps: 0,
    amountOffCents: 500,
  },
  {
    id: 'bowman-late',
    codePrefix: 'BOWMAN',
    title: 'Bowman late plate',
    detail: '20% off a downtown drop-off after 9:00 PM, Thursday through Saturday.',
    percentOffBps: 2000,
    amountOffCents: 0,
  },
  {
    id: 'hendrix-morning',
    codePrefix: 'HENDRIX',
    title: 'Hendrix morning',
    detail: '15% off a ride before 9:00 AM that starts at Hendrix.',
    percentOffBps: 1500,
    amountOffCents: 0,
  },
  {
    id: 'orange-hour',
    codePrefix: 'ORANGEHR',
    title: 'Orange hour',
    detail: '$4 off a ride requested between 5:00 and 6:00 PM.',
    percentOffBps: 0,
    amountOffCents: 400,
  },
  {
    id: 'night-owl',
    codePrefix: 'NIGHTOWL',
    title: 'Night owl',
    detail: '35% off a ride requested after midnight.',
    percentOffBps: 3500,
    amountOffCents: 0,
  },
  {
    id: 'comfort-sunday',
    codePrefix: 'COMFORT',
    title: 'Sunday Extra Comfort',
    detail: '$7 off Extra Comfort on Sunday. Standard and Wait & Save stay at the regular fare.',
    percentOffBps: 0,
    amountOffCents: 700,
  },
  {
    id: 'wait-wednesday',
    codePrefix: 'WAITWED',
    title: 'Wait & Save Wednesday',
    detail: 'An extra 10% off Wait & Save booked on Wednesday.',
    percentOffBps: 1000,
    amountOffCents: 0,
  },
  {
    id: 'library-late',
    codePrefix: 'LIBRARY',
    title: 'Library late',
    detail: '$3 off a Cooper Library pickup after 8:00 PM.',
    percentOffBps: 0,
    amountOffCents: 300,
  },
  {
    id: 'lake-crossing',
    codePrefix: 'LAKEHR',
    title: 'Lake crossing',
    detail: '$6 off a ride toward Anderson that crosses the lake.',
    percentOffBps: 0,
    amountOffCents: 600,
  },
  {
    id: 'monday-schedule',
    codePrefix: 'MONDAY',
    title: 'Monday on the books',
    detail: '$5 off a ride scheduled for Monday at least 30 minutes ahead.',
    percentOffBps: 0,
    amountOffCents: 500,
  },
  {
    id: 'college-ave-porch',
    codePrefix: 'COLLEGE',
    title: 'College Ave porch',
    detail: '$4 off a ride that ends on College Avenue after 10:00 PM.',
    percentOffBps: 0,
    amountOffCents: 400,
  },
]

export function newYorkParts(date) {
  const when = date instanceof Date ? date : new Date(date)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: FRIDAY_DROP_TIME_ZONE,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(when)
  const read = (type) => parts.find((part) => part.type === type)?.value
  let hour = Number(read('hour'))
  if (hour === 24) hour = 0
  return {
    weekday: read('weekday'),
    year: Number(read('year')),
    month: Number(read('month')),
    day: Number(read('day')),
    hour,
    minute: Number(read('minute')),
  }
}

export function dropKeyFromParts(parts) {
  const month = String(parts.month).padStart(2, '0')
  const day = String(parts.day).padStart(2, '0')
  return `${parts.year}-${month}-${day}`
}

function shiftNyDate(parts, days) {
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day, 16, 0, 0)
  return newYorkParts(new Date(utc + days * 24 * 60 * 60 * 1000))
}

/** The Friday whose noon ET drop is currently on the homepage. */
export function currentDropParts(now = new Date()) {
  const parts = newYorkParts(now)
  const weekdayIndex = WEEKDAYS.indexOf(parts.weekday)
  let daysBack = (weekdayIndex - 5 + 7) % 7
  const beforeNoon = parts.hour < FRIDAY_DROP_HOUR_ET
  if (daysBack === 0 && beforeNoon) daysBack = 7
  if (daysBack === 0) return parts
  return shiftNyDate(parts, -daysBack)
}

export function isFridayDropWindow(now = new Date()) {
  const parts = newYorkParts(now)
  return parts.weekday === 'Fri' && parts.hour === FRIDAY_DROP_HOUR_ET
}

function weeksSinceEpoch(parts) {
  const origin = Date.UTC(EPOCH_FRIDAY.year, EPOCH_FRIDAY.month - 1, EPOCH_FRIDAY.day)
  const drop = Date.UTC(parts.year, parts.month - 1, parts.day)
  return Math.round((drop - origin) / (7 * 24 * 60 * 60 * 1000))
}

function couponCode(prefix, dropKey) {
  const stamp = dropKey.replace(/-/g, '').slice(2)
  return `${prefix}${stamp}`.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 16)
}

export function couponForDrop(parts) {
  const dropKey = dropKeyFromParts(parts)
  const index = ((weeksSinceEpoch(parts) % WEEKLY_COUPON_CONCEPTS.length) + WEEKLY_COUPON_CONCEPTS.length)
    % WEEKLY_COUPON_CONCEPTS.length
  const concept = WEEKLY_COUPON_CONCEPTS[index]
  return {
    id: `${concept.id}:${dropKey}`,
    conceptId: concept.id,
    dropKey,
    code: couponCode(concept.codePrefix, dropKey),
    title: concept.title,
    detail: concept.detail,
    percentOffBps: concept.percentOffBps,
    amountOffCents: concept.amountOffCents,
    dropHourEt: FRIDAY_DROP_HOUR_ET,
    timeZone: FRIDAY_DROP_TIME_ZONE,
    dropLabel: `Friday ${dropKey} at 12:00 PM Eastern`,
  }
}

export function currentWeeklyCoupon(now = new Date()) {
  return couponForDrop(currentDropParts(now))
}

export function fridayDropEmail({ coupon, firstName } = {}) {
  const name = String(firstName || '').trim().split(/\s+/)[0] || 'Tiger'
  const offer = coupon?.percentOffBps
    ? `${coupon.percentOffBps / 100}% off`
    : `$${(Number(coupon?.amountOffCents) / 100).toFixed(2)} off`
  return {
    subject: `This week’s Clemson RIDES coupon: ${coupon?.title || 'Friday drop'}`,
    text: [
      `Hi ${name},`,
      '',
      `This week’s coupon is ${coupon?.code}: ${coupon?.title}.`,
      `${coupon?.detail || ''} (${offer}).`,
      coupon?.dropLabel ? `It dropped ${coupon.dropLabel}.` : '',
      '',
      'Refer two friends and your next ride is free. Both friends have to sign up and verify a Clemson .edu email (@clemson.edu or @g.clemson.edu). Signups that are not verified .edu addresses do not count.',
      '',
      'Standing offers stay available: 50% off your first ride, 50% off after two completed rides that each cost more than $20, and $100 in prepaid ride credits for $75. That 25% bonus is only on the prepaid package.',
      '',
      'Stripe places a pre-authorization hold for the estimated fare plus a buffer. The full fare is charged when the trip ends.',
    ].filter((line) => line !== '').join('\n'),
  }
}

export function applyWeeklyCoupon(fareCents, coupon) {
  const fare = Math.max(0, Math.round(Number(fareCents) || 0))
  if (!coupon) return { fareCents: fare, discountCents: 0 }
  const percent = Math.round(fare * (Number(coupon.percentOffBps) || 0) / 10000)
  const fixed = Math.round(Number(coupon.amountOffCents) || 0)
  const discountCents = Math.min(fare, percent || fixed)
  return { fareCents: fare - discountCents, discountCents }
}
