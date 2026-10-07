/**
 * Marketing differentiators for the homepage, the Why Clemson Rides page,
 * and the Drive page.
 *
 * PROD GATE: keep DIFFERENTIATOR_CLAIMS_AWAIT_FEATURE_PRS true until the
 * messaging, scheduled-boost, and backup-queue pull requests are in the
 * production release. Do not publish this copy on production while the
 * flag is true.
 *
 * On this staging branch those three are already in the app. Dollar amounts
 * come from the fare, boost, backup, and Tiger Pass constants.
 * "Only at Clemson Rides" is used only for the backup driver and the
 * confirm-before-pickup rule. Do not name other ride companies here.
 */
import { BACKUP_BONUS_PRESETS_CENTS } from '../../shared/backupDriverQueue.js'
import { BOOST_DRIVER_SHARE_BPS, BOOST_PRESETS_CENTS, formatBoostDollars } from '../../shared/scheduledBoost.js'
import { TIGER_PASS_DISCOUNT_PCT, TIGER_PASS_NAME, TIGER_PASS_PRICE_CENTS } from '../../shared/tigerPass.js'
import { CARPOOL_DISCOUNT_BPS, STUDENT_DISCOUNT_BPS } from '../lib/fareRates.js'
import { DESTINATIONS } from '../store.js'

/** Flip to false only after messaging, boost, and backup-queue PRs are in the prod release. */
export const DIFFERENTIATOR_CLAIMS_AWAIT_FEATURE_PRS = true

export const CONFIRM_LEAD_MINUTES = 5

export const HOMEPAGE_HEADLINE = 'Peace of mind, door to airport.'

export const HOMEPAGE_SUBLINE = "Drivers confirm before they come. A backup is ready if they don't."

export const ONLY_AT_CLEMSON_RIDES = 'Only at Clemson Rides'

export const RELEASE_NOTE = 'Messaging after a driver accepts, boosts, a backup driver, and the 5-minute confirm are in the app.'

function moneyList(centsList) {
  const amounts = centsList.map((cents) => formatBoostDollars(cents))
  if (amounts.length <= 1) return amounts[0] || ''
  if (amounts.length === 2) return `${amounts[0]} or ${amounts[1]}`
  return `${amounts.slice(0, -1).join(', ')}, or ${amounts[amounts.length - 1]}`
}

function driverKeepsBoost() {
  if (BOOST_DRIVER_SHARE_BPS >= 10000) return 'Your driver keeps all of it.'
  const pct = Math.round(BOOST_DRIVER_SHARE_BPS / 100)
  return `Your driver keeps ${pct}% of it.`
}

function airportFare(id) {
  const place = DESTINATIONS.find((item) => item.id === id)
  return formatBoostDollars(place?.fare || 0)
}

const boostChoices = moneyList(BOOST_PRESETS_CENTS)
const backupChoices = moneyList(BACKUP_BONUS_PRESETS_CENTS)
const studentPercent = STUDENT_DISCOUNT_BPS / 100
const carpoolPercent = CARPOOL_DISCOUNT_BPS / 100
const passPrice = formatBoostDollars(TIGER_PASS_PRICE_CENTS)

export const RIDER_DIFFERENTIATORS = [
  {
    id: 'backup-driver',
    title: 'Backup driver',
    exclusive: true,
    body: `Add a second driver for ${backupChoices} on a scheduled ride. If the first driver cannot make it, the backup takes the trip.`,
  },
  {
    id: 'confirm',
    title: 'Drivers confirm first',
    exclusive: true,
    body: `Your driver confirms ${CONFIRM_LEAD_MINUTES} minutes before pickup, or the backup takes over. With no backup, the ride opens to every driver.`,
  },
  {
    id: 'on-the-way',
    title: 'On the way',
    exclusive: false,
    body: 'After they confirm, a countdown starts. When it hits zero, navigation starts and you are told to sit tight, because your driver is on the way.',
  },
  {
    id: 'switch-cancel',
    title: 'Switch or cancel',
    exclusive: false,
    body: `You can switch once before your driver starts toward you, or cancel. The first driver gets the ${backupChoices}, a switch never counts against them, and a cancel pays that fee to the first driver only.`,
  },
  {
    id: 'boosts',
    title: 'Boost a scheduled ride',
    exclusive: false,
    body: `Add ${boostChoices}, or your own amount, on a scheduled ride. ${driverKeepsBoost()}`,
  },
  {
    id: 'messaging',
    title: 'Message your driver',
    exclusive: false,
    body: 'You can message after a driver accepts, and during the ride. After the ride, chat opens again only for a lost item.',
  },
  {
    id: 'carpool',
    title: 'Carpool',
    exclusive: false,
    body: `Carpool is ${carpoolPercent}% off Standard, for 1 or 2 seats. It does not pair you with other riders.`,
  },
  {
    id: 'tiger-pass',
    title: TIGER_PASS_NAME,
    exclusive: false,
    body: `${TIGER_PASS_NAME} is ${passPrice} a month and takes ${TIGER_PASS_DISCOUNT_PCT}% off Standard, Wait & Save, Extra Comfort, and Carpool. Drivers you save can be offered first.`,
  },
  {
    id: 'tiger-heat',
    title: 'Tiger Heat',
    exclusive: false,
    body: 'Busy pickup areas pay drivers extra. This is driver pay, not a lower fare for you.',
  },
  {
    id: 'women-only',
    title: 'Women-only',
    exclusive: false,
    body: 'If you identify as a woman, you can ask for a woman driver. Matching then skips drivers who do not match.',
  },
  {
    id: 'safety',
    title: 'Safety on the ride',
    exclusive: false,
    body: 'You can record on your phone during the ride. The clip stays on the phone, and you can share the trip or use SOS.',
  },
  {
    id: 'favorites',
    title: 'Favorite drivers',
    exclusive: false,
    body: 'Save a driver from Pick a driver. Saved drivers are offered before the open pool.',
  },
  {
    id: 'clemson',
    title: 'Built for Clemson',
    exclusive: false,
    body: 'This is a student ride product for this campus, not an official Clemson University service. Pickups are campus places, plus scheduled airport rides.',
  },
  {
    id: 'student',
    title: 'Student price',
    exclusive: false,
    body: `A confirmed @clemson.edu or @g.clemson.edu email gets ${studentPercent}% off Standard, including airport flats. That discount does not include Carpool.`,
  },
  {
    id: 'game-day',
    title: 'Game day',
    exclusive: false,
    body: 'When a game day is live, the home screen shows the pickup zone and the fare. You can also schedule a game-day ride.',
  },
  {
    id: 'weekend',
    title: 'Weekend and party',
    exclusive: false,
    body: 'You can schedule a Friday or Saturday night ride. Drivers see those as weekend and party pickups.',
  },
  {
    id: 'airports',
    title: 'Airport rides',
    exclusive: false,
    body: `Schedule a ride to Greenville-Spartanburg (GSP) for ${airportFare('gsp')} or Charlotte Douglas (CLT) for ${airportFare('clt')}.`,
  },
]

export const DRIVER_EARNINGS = [
  {
    id: 'boost-pay',
    title: 'Keep the boost',
    steps: [
      `Riders can add ${boostChoices}, or their own amount, on a scheduled ride.`,
      BOOST_DRIVER_SHARE_BPS >= 10000
        ? 'You keep all of that boost.'
        : `You keep ${Math.round(BOOST_DRIVER_SHARE_BPS / 100)}% of that boost.`,
    ],
  },
  {
    id: 'backup-pay',
    title: 'Backup pay',
    steps: [
      `Being the second driver pays ${backupChoices} for being ready.`,
      'You still get it if you are not needed, as long as you stay available.',
      'If the first driver does not confirm, you take the trip.',
    ],
  },
  {
    id: 'switch-fee',
    title: 'Switch or cancel',
    steps: [
      `If the rider switches, the first driver gets the ${backupChoices}. A switch never counts against you.`,
      'If the rider cancels, the first driver gets that fee. The second driver does not.',
    ],
  },
]
