/**
 * In-car tablet ads API. One file, routed by ?action=.
 *   GET  packages                         public: buyable packages (empty until real tiers are approved)
 *   POST upload-url                       public, rate limited: signed upload URL for a creative (ad-creatives bucket)
 *   POST signup                           public, rate limited, honeypot: partner + campaign (pending_payment) + creative (pending_review)
 *   GET  mine                             signed-in partner: own campaigns with live counters (runs, impressions, rides, QR scans)
 *   GET  qr&token=                        public (/q/<token>): log a QR scan, then 302 to the partner's deal URL
 *   POST apply                            public, rate limited, honeypot: founding-partner application (pending)
 *   POST partner-campaign|partner-launch|partner-boost   signed-in, onboarded partner: build / create / launch / boost
 *   GET  tablet-feed                      device token (X-Device-Token): rotation loop + creatives + trip state
 *   POST tablet-impressions               device token: impression batch; counts a ride per campaign per in-progress trip
 *   GET  admin-overview                   owner only
 *   POST admin-creative|admin-campaign|admin-device|admin-package|admin-bill|admin-partner|admin-application|admin-boost   owner only
 *   GET/POST cron                         Bearer CRON_SECRET: reminders / pause unpaid / ending notices / monthly report (flags off = plan only)
 */
import { cors, json, parseBody, rateLimit } from '../server/agentHttp.js'
import { admin, stripeClient, userFromAuth } from '../server/friendRideLib.js'
import { KNOWN_OWNER_EMAILS, adminNotifyRecipients, isDeniedAdminEmail } from '../server/adminRoster.js'
import { sendApplicantNotice } from '../server/applicantMail.js'
import { cronAuthorized } from '../server/endpoints/driverPayouts.js'
import { stagingCronBlock } from '../server/cronGuard.js'
import { normalizeEmail } from '../shared/adminAccess.js'
import { WEB_ORIGIN, supportEmail } from '../shared/productLinks.js'
import { signupErrors, uploadErrors } from '../shared/ads/signup.js'
import {
  adminCampaign, adminCreative, adminDevice, adminOverview, adminPackage, createUploadUrl, deviceFromToken,
  impressionStats, listPackages, recordImpressions, signupPartner, tabletFeed,
} from '../server/ads/service.js'
import { adsBillingEnabled, startBoostPayment, startCampaignPayment } from '../server/ads/billing.js'
import {
  adminApplication, adminBoost, adminPartner, adminTracking, clientIp, partnerBoost, partnerDashboard,
  partnerLaunchCampaign, partnerSaveCampaign, recordQrScan, submitApplication,
} from '../server/ads/tracking.js'
import { APPLICATION_HONEYPOT, applicationErrors } from '../shared/ads/application.js'
import { runAdsAutomation } from '../server/ads/automation.js'

export const ADS_ACTIONS = new Set([
  'packages', 'upload-url', 'signup', 'mine', 'tablet-feed', 'tablet-impressions',
  'admin-overview', 'admin-creative', 'admin-campaign', 'admin-device', 'admin-package', 'admin-bill', 'cron',
  'qr', 'apply', 'partner-campaign', 'partner-launch', 'partner-boost', 'admin-partner', 'admin-application', 'admin-boost',
])

const QR_RATE = { limit: 30, windowMs: 10 * 60_000 }

/** Ads admin is the owner account only (johnmatveyev@gmail.com via KNOWN_OWNER_EMAILS). */
export function isAdsOwner(user) {
  const email = normalizeEmail(user?.email)
  return Boolean(email) && !isDeniedAdminEmail(email) && KNOWN_OWNER_EMAILS.includes(email)
}

const PUBLIC_RATE = { limit: 6, windowMs: 10 * 60_000 }

function deviceToken(req, url) {
  return String(req.headers?.['x-device-token'] || url.searchParams.get('device') || '').trim()
}

export function createAdsHandler(deps = {}) {
  const db = deps.db || (() => admin())
  const auth = deps.auth || userFromAuth
  const limit = deps.limit || ((req, bucket) => rateLimit(req, { bucket, ...(bucket === 'ad-qr' ? QR_RATE : PUBLIC_RATE) }))
  const send = deps.send || sendApplicantNotice
  const recipients = deps.recipients || (() => adminNotifyRecipients())
  const stripe = deps.stripe || (() => stripeClient())
  const env = deps.env || process.env
  const clock = deps.now || (() => new Date())

  return async function adsHandler(req, res) {
    if (cors(req, res)) return
    const url = new URL(req.url || '/', 'http://localhost')
    const action = url.searchParams.get('action') || ''
    if (!ADS_ACTIONS.has(action)) return json(res, 400, { error: 'Unknown or missing action' })
    const post = req.method === 'POST'
    let body = {}
    if (post) {
      const parsed = parseBody(req)
      if (parsed.error) return json(res, 400, { error: parsed.error })
      body = parsed.body || {}
    }
    const sb = db()
    if (!sb) return json(res, 503, { error: `Ads are offline right now. Email ${supportEmail()}.` })
    const now = clock()
    try {
      switch (action) {
        case 'packages':
          return json(res, 200, { packages: await listPackages(sb) })
        case 'upload-url': {
          if (!post) return json(res, 405, { error: 'Use POST' })
          if (!limit(req, 'ad-upload')) return json(res, 429, { error: 'Too many uploads. Try again in a few minutes.' })
          const bad = uploadErrors(body)
          if (bad) return json(res, 400, { error: bad })
          return json(res, 200, await createUploadUrl(sb, body))
        }
        case 'signup': {
          if (!post) return json(res, 405, { error: 'Use POST' })
          if (String(body.website2 || '').trim()) return json(res, 200, { ok: true })
          if (!limit(req, 'ad-signup')) return json(res, 429, { error: 'Too many sign-ups. Try again in a few minutes.' })
          const errors = signupErrors(body)
          if (Object.keys(errors).length) return json(res, 400, { error: 'Fix the highlighted fields.', errors })
          const user = await auth(req).catch(() => null)
          const out = await signupPartner(sb, body, { user, now })
          try {
            for (const to of recipients() || []) {
              await send({ to, subject: `New ad partner: ${out.partner.business_name}`, text: `${out.partner.business_name} signed up for in-car tablet ads (${out.campaign.name}). Review the creative at ${WEB_ORIGIN}/admin?tab=ads.` })
            }
          } catch (err) { console.error('[ads] notify', err?.message || err) }
          return json(res, 200, { ok: true, campaignId: out.campaign.id, status: out.campaign.status, creativeStatus: out.creative.approval_status })
        }
        case 'qr': {
          const out = await recordQrScan(sb, url.searchParams.get('token'), {
            userAgent: req.headers?.['user-agent'] || '', ip: clientIp(req), now, allowLog: limit(req, 'ad-qr'),
          })
          res.statusCode = 302
          res.setHeader('Location', out.location)
          res.setHeader('Cache-Control', 'no-store')
          res.setHeader('Referrer-Policy', 'no-referrer')
          return res.end()
        }
        case 'apply': {
          if (!post) return json(res, 405, { error: 'Use POST' })
          if (String(body[APPLICATION_HONEYPOT] || '').trim()) return json(res, 200, { ok: true })
          if (!limit(req, 'ad-apply')) return json(res, 429, { error: 'Too many applications. Try again in a few minutes.' })
          const errors = applicationErrors(body)
          if (Object.keys(errors).length) return json(res, 400, { error: 'Fix the highlighted fields.', errors })
          const app = await submitApplication(sb, body)
          try {
            for (const to of recipients() || []) {
              await send({ to, subject: `Founding partner application: ${app.business_name}`, text: `${app.business_name} applied to become a founding partner. Review it at ${WEB_ORIGIN}/admin?tab=ads.` })
            }
          } catch (err) { console.error('[ads] notify', err?.message || err) }
          return json(res, 200, { ok: true, status: app.status })
        }
        case 'mine': {
          const user = await auth(req)
          if (!user) return json(res, 401, { error: 'Sign in required' })
          return json(res, 200, await partnerDashboard(sb, user))
        }
        case 'partner-campaign':
        case 'partner-launch':
        case 'partner-boost': {
          if (!post) return json(res, 405, { error: 'Use POST' })
          const user = await auth(req)
          if (!user) return json(res, 401, { error: 'Sign in required' })
          if (action === 'partner-campaign') return json(res, 200, await partnerSaveCampaign(sb, user, body, { now }))
          if (action === 'partner-launch') return json(res, 200, await partnerLaunchCampaign(sb, user, body, { now }))
          const out = await partnerBoost(sb, user, body, { now })
          if (out.boost) out.billing = await startBoostPayment({ stripe: adsBillingEnabled(env) ? stripe() : null, sb, boostId: out.boost.id, env })
          return json(res, 200, out)
        }
        case 'tablet-feed':
        case 'tablet-impressions': {
          const device = await deviceFromToken(sb, deviceToken(req, url), { now })
          if (!device) return json(res, 401, { error: 'This tablet is not paired. Ask an admin for a device link.' })
          if (action === 'tablet-feed') {
            const override = url.searchParams.get('gameday')
            return json(res, 200, await tabletFeed(sb, device, { now, gameDayOverride: device.demo && override ? override === '1' : null }))
          }
          if (!post) return json(res, 405, { error: 'Use POST' })
          return json(res, 200, await recordImpressions(sb, device, body.impressions, { now }))
        }
        case 'cron': {
          if (!cronAuthorized(req, env.CRON_SECRET)) return json(res, 401, { error: 'Bearer CRON_SECRET required' })
          const blocked = stagingCronBlock(env)
          if (blocked) return json(res, blocked.status, blocked.body)
          const stats = async (c) => (await impressionStats(sb, [c.id]))[c.id] || {}
          return json(res, 200, await runAdsAutomation({ sb, env, now, send, stats }))
        }
        default: {
          const user = await auth(req)
          if (!user) return json(res, 401, { error: 'Sign in required' })
          if (!isAdsOwner(user)) return json(res, 403, { error: 'Ads admin is limited to the owner account.' })
          if (action === 'admin-overview') {
            const overview = await adminOverview(sb)
            return json(res, 200, { ...overview, ...(await adminTracking(sb, overview.campaigns)) })
          }
          if (!post) return json(res, 405, { error: 'Use POST' })
          if (action === 'admin-creative') return json(res, 200, { creative: await adminCreative(sb, body, { now }) })
          if (action === 'admin-campaign') return json(res, 200, { campaign: await adminCampaign(sb, body, { now }) })
          if (action === 'admin-device') return json(res, 200, await adminDevice(sb, body))
          if (action === 'admin-package') return json(res, 200, { package: await adminPackage(sb, body, { now }) })
          if (action === 'admin-partner') return json(res, 200, { partner: await adminPartner(sb, body, { now }) })
          if (action === 'admin-application') return json(res, 200, await adminApplication(sb, body, { now }))
          if (action === 'admin-boost') return json(res, 200, await adminBoost(sb, body, { now }))
          return json(res, 200, await startCampaignPayment({ stripe: stripe(), sb, campaignId: body.campaignId, mode: body.mode, origin: WEB_ORIGIN, env }))
        }
      }
    } catch (err) {
      const status = Number(err?.status) || 500
      if (status >= 500) console.error('[ads]', action, err?.message || err)
      return json(res, status, { error: status >= 500 ? 'Something went wrong. Try again.' : err.message, ...(err.errors ? { errors: err.errors } : {}) })
    }
  }
}

export default createAdsHandler()
