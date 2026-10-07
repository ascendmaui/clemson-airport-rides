/**
 * Homepage line, driver earnings, and the production gate for marketing claims.
 *
 * PROD GATE: keep DIFFERENTIATOR_CLAIMS_AWAIT_FEATURE_PRS true until the
 * messaging, scheduled-boost, and backup-queue pull requests are in the
 * production release. Do not publish this copy on production while the
 * flag is true.
 *
 * Rider feature sections live in src/content/features.js.
 * "Only at Clemson Rides" is used only for the backup driver and the
 * confirm-before-pickup rule. Do not name other ride companies here.
 */
import { BACKUP_BONUS_PRESETS_CENTS } from '../../shared/backupDriverQueue.js'
import { BOOST_DRIVER_SHARE_BPS, BOOST_PRESETS_CENTS, formatBoostDollars } from '../../shared/scheduledBoost.js'
import { FEATURES } from './features.js'

/** Flip to false only after messaging, boost, and backup-queue PRs are in the prod release. */
export const DIFFERENTIATOR_CLAIMS_AWAIT_FEATURE_PRS = true

export const HOMEPAGE_HEADLINE = 'Peace of mind'

export const HOMEPAGE_SUBLINE = "Drivers confirm before they come. A backup is ready if they don't."

export const RELEASE_NOTE = 'Messaging after a driver accepts, boosts, a backup driver, and the 5-minute confirm are in the app.'

function choiceList(centsList) {
  const amounts = centsList.map((cents) => formatBoostDollars(cents))
  if (amounts.length <= 1) return amounts[0] || ''
  if (amounts.length === 2) return `${amounts[0]} or ${amounts[1]}`
  return `${amounts.slice(0, -1).join(', ')}, or ${amounts[amounts.length - 1]}`
}

const boostChoices = choiceList(BOOST_PRESETS_CENTS)
const backupChoices = choiceList(BACKUP_BONUS_PRESETS_CENTS)

/** Overview cards. The full what / steps / why live on FEATURES. */
export const RIDER_DIFFERENTIATORS = FEATURES.map((item) => ({
  id: item.id,
  title: item.title,
  exclusive: item.exclusive,
  body: item.what,
}))

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
