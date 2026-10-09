/**
 * POST /api/driver?action=signup|submit-review|offer-preview|tip|tip-choice|wait|trip-status|cancel-midride|payouts|cards
 * GET  /api/driver?action=earnings|payouts|app-config
 * Legacy paths are rewritten in vercel.json.
 * trip-wait body.action (arrive|tick|cancel|start|complete) is a sub-action, not the route.
 */
import { admin, cors, json, userFromAuth } from '../server/friendRideLib.js'
import { resolveRouteAction } from '../server/routeAction.js'
import { handleDriverSignup, handleDriverSubmitReview } from '../server/driverRoutes.js'
import handleDriverEarnings from '../server/endpoints/driverEarnings.js'
import handleOfferPreview from '../server/endpoints/tripOfferPreview.js'
import handleTripTip from '../server/endpoints/tripTip.js'
import handleRiderTipChoice from '../server/endpoints/riderTipChoice.js'
import handleTripWait from '../server/endpoints/tripWait.js'
import handleTripStatus from '../server/endpoints/tripStatus.js'
import handleCancelMidride from '../server/endpoints/tripCancelMidride.js'
import handleDriverPayouts from '../server/endpoints/driverPayouts.js'
import handleApplicantInbox from '../server/endpoints/applicantInbox.js'
import handleDriverCards from '../server/endpoints/driverCards.js'
import handleTripSweeps from '../server/endpoints/tripSweeps.js'
import handleMatchingRebroadcast from '../server/endpoints/matchingRebroadcast.js'
import { handleMarkOffered, handlePassOffer } from '../server/endpoints/driverOfferDesk.js'
import { handleSignAgreement } from '../server/agreementHttp.js'
import handleAppConfig from '../server/endpoints/appConfig.js'
import handleBackupQueue from '../server/endpoints/backupQueue.js'

const HANDLERS = {
  'app-config': handleAppConfig,
  signup: handleDriverSignup,
  'submit-review': handleDriverSubmitReview,
  earnings: handleDriverEarnings,
  'offer-preview': handleOfferPreview,
  tip: handleTripTip,
  'tip-choice': handleRiderTipChoice,
  wait: handleTripWait,
  'trip-status': handleTripStatus,
  'cancel-midride': handleCancelMidride,
  payouts: handleDriverPayouts,
  inbox: handleApplicantInbox,
  cards: handleDriverCards,
  'rebroadcast-offers': handleMatchingRebroadcast,
  'trip-sweeps': handleTripSweeps,
  'mark-offered': handleMarkOffered,
  'pass-offer': handlePassOffer,
  'sign-agreement': handleSignAgreementRoute,
  'backup-queue': handleBackupQueue,
}

const LEGACY = {
  'driver-signup': 'signup',
  'driver-submit-review': 'submit-review',
  'driver-earnings': 'earnings',
  'trip-offer-preview': 'offer-preview',
  'trip-tip': 'tip',
  'trip-wait': 'wait',
  'trip-cancel-midride': 'cancel-midride',
  'driver-payouts': 'payouts',
}

export default async function handler(req, res, ...rest) {
  if (cors(req, res)) return
  const action = resolveRouteAction(req, { allowed: Object.keys(HANDLERS), legacy: LEGACY })
  const handle = HANDLERS[action]
  if (!handle) {
    return json(res, 400, {
      error: 'Unknown driver action. Use action=signup, submit-review, earnings, offer-preview, tip, tip-choice, wait, trip-status, cancel-midride, payouts, inbox, cards, mark-offered, pass-offer, sign-agreement, backup-queue, trip-sweeps, or app-config.',
    })
  }
  return handle(req, res, ...rest)
}

async function handleSignAgreementRoute(req, res) {
  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })
  return handleSignAgreement(req, res, sb, user)
}
