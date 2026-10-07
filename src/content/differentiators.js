/**
 * Marketing differentiators for the Why Clemson Rides page, the Drive page,
 * and the one homepage trust line.
 *
 * PROD GATE: keep DIFFERENTIATOR_CLAIMS_AWAIT_FEATURE_PRS true until the
 * messaging, scheduled-boost, and backup-queue pull requests are in the
 * production release. Do not publish this copy on production while the
 * flag is true.
 *
 * On this staging branch those three are already in the app. Backup fee
 * amounts come from the backup queue. They must still match production
 * before this copy ships there.
 */
import { BACKUP_BONUS_PRESETS_CENTS, RIDER_ENROUTE_COPY } from '../../shared/backupDriverQueue.js'
import { BOOST_DRIVER_SHARE_BPS, BOOST_PRESETS_CENTS, formatBoostDollars } from '../../shared/scheduledBoost.js'

/** Flip to false only after messaging, boost, and backup-queue PRs are in the prod release. */
export const DIFFERENTIATOR_CLAIMS_AWAIT_FEATURE_PRS = true

export const CONFIRM_LEAD_MINUTES = 5

export const HOMEPAGE_TRUST_LINE = 'Guaranteed airport pickups. Drivers confirm before they come.'

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

const boostChoices = moneyList(BOOST_PRESETS_CENTS)
const backupChoices = moneyList(BACKUP_BONUS_PRESETS_CENTS)

export const ON_THE_WAY_LINE = `A countdown starts. When it hits zero, navigation starts. ${RIDER_ENROUTE_COPY}`

export const RIDER_DIFFERENTIATORS = [
  {
    id: 'airport-backup',
    title: 'Guaranteed airport pickups',
    steps: [
      'Schedule a ride to the airport.',
      `Add a backup driver for ${backupChoices}.`,
      'If your driver cannot make it, the backup takes the trip.',
    ],
  },
  {
    id: 'no-flake',
    title: 'No-flake drivers',
    steps: [
      `Your driver confirms ${CONFIRM_LEAD_MINUTES} minutes before pickup.`,
      'If they do not, your backup takes over.',
      'If there is no backup, the ride opens to every driver.',
      ON_THE_WAY_LINE,
    ],
  },
  {
    id: 'message',
    title: 'Message your driver',
    steps: [
      'You can message after a driver accepts, and during the ride.',
      'After the ride, chat opens again only for a lost item.',
      'The driver reports it with Report a lost item.',
    ],
  },
  {
    id: 'control',
    title: 'You are in control',
    steps: [
      `Add a boost of ${boostChoices}, or your own amount, so a driver takes the ride sooner. ${driverKeepsBoost()}`,
      'Add a backup driver when you schedule.',
      `You can switch once. The first driver gets the ${backupChoices}. A switch never counts against them.`,
      'If you cancel, the first driver gets that fee. The second driver does not.',
    ],
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
