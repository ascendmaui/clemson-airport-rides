/**
 * Admin to-do inbox. Pure grouping of rows the server already stores.
 * Actions name the existing admin endpoints. This module does not write.
 */
import { backgroundGateFromApplication } from './backgroundCheck.js'
import { WEB_ORIGIN } from './productLinks.js'

/** Same window as server/staleTripSweep.js STALE_TRIP_MS. */
export const STUCK_AFTER_MS = 15 * 60 * 1000
export const INSPECTION_DUE_SOON_MS = 7 * 24 * 60 * 60 * 1000

export const WEB_ADMIN_URL = `${WEB_ORIGIN}/admin`

export const INBOX_KINDS = [
  'failed_hold',
  'stuck_trip',
  'flagged_message',
  'inspection',
  'lost_item',
  'photo_review',
  'document_review',
  'driver_approval',
  'background_attestation',
  'payout_w9',
]

export const INBOX_KIND_LABELS = {
  failed_hold: 'Failed holds',
  stuck_trip: 'Stuck trips',
  flagged_message: 'Flagged messages',
  inspection: 'Inspections',
  lost_item: 'Lost items',
  photo_review: 'Photo review',
  document_review: 'Document review',
  driver_approval: 'Driver approvals',
  background_attestation: 'Background attestation',
  payout_w9: 'Payouts and W-9',
}

const DOC_REVIEW = new Set([
  'pending',
  'pending_manual_review',
  'pending-manual-review',
  'manual_review',
  'manual-review',
  'needs_review',
  'needs-review',
  'pending_admin_review',
  'pending-admin-review',
])

const PHOTO_REVIEW = new Set([
  'pending_admin_review',
  'pending-admin-review',
  'pending_manual_review',
  'pending-manual-review',
])

const STUCK_ACTIVE = new Set(['accepted', 'arriving', 'arrived', 'in_progress'])
const STUCK_OPEN = new Set(['searching', 'offered', 'requested'])
const INSPECTION_PHOTOS = ['inspection_front', 'inspection_back', 'inspection_left', 'inspection_right']
const INSPECTION_SOURCES = new Set(['lyft', 'uber', 'other_platform', 'independent'])

const URGENCY = {
  failed_hold: 100,
  stuck_trip: 90,
  flagged_message: 85,
  inspection_overdue: 80,
  lost_item: 72,
  photo_review: 68,
  document_review: 66,
  driver_approval: 62,
  background_attestation: 58,
  inspection_due: 52,
  payout_w9: 48,
}

export function ageMs(iso, now = new Date()) {
  const at = Date.parse(iso || '')
  const wall = now instanceof Date ? now.getTime() : new Date(now).getTime()
  if (!Number.isFinite(at) || !Number.isFinite(wall)) return 0
  return Math.max(0, wall - at)
}

export function formatAge(ms) {
  const n = Math.max(0, Math.round(Number(ms) || 0))
  if (n < 60_000) return 'just now'
  const minutes = Math.floor(n / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function norm(value) {
  return String(value || '').trim().toLowerCase()
}

function statusKey(value) {
  return norm(value).replace(/[\s-]+/g, '_')
}

export function isManualDocumentStatus(status) {
  const raw = norm(status)
  if (!raw) return false
  if (DOC_REVIEW.has(raw) || DOC_REVIEW.has(raw.replace(/_/g, '-'))) return true
  return DOC_REVIEW.has(statusKey(status))
}

export function isPhotoReviewStatus(status) {
  const raw = norm(status)
  if (!raw) return false
  return PHOTO_REVIEW.has(raw) || PHOTO_REVIEW.has(raw.replace(/_/g, '-'))
}

function metaOf(row) {
  const meta = row?.metadata
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {}
}

function person(profiles, id, fallback) {
  const row = id ? profiles?.[id] : null
  return row?.full_name || row?.email || fallback
}

function when(...values) {
  for (const value of values) {
    if (value && Number.isFinite(Date.parse(value))) return value
  }
  return null
}

function futureSchedule(trip, nowMs) {
  const pickup = Date.parse(trip?.pickup_at || '')
  const scheduled = Date.parse(trip?.scheduled_for || '')
  return (Number.isFinite(pickup) && pickup > nowMs) || (Number.isFinite(scheduled) && scheduled > nowMs)
}

function adminUrl(tab) {
  return tab ? `${WEB_ADMIN_URL}?tab=${encodeURIComponent(tab)}` : WEB_ADMIN_URL
}

function openApplicant(profileId) {
  return {
    id: 'open-applicant',
    label: 'Open applicant',
    method: 'GET',
    path: '/api/admin-drivers',
    query: { profile_id: profileId },
    navigate: { path: 'admin', tab: 'applications' },
    webUrl: adminUrl('applications'),
  }
}

function openTrips() {
  return {
    id: 'open-trip',
    label: 'Open trip',
    method: 'GET',
    path: '/api/admin',
    query: { action: 'trips' },
    navigate: { path: 'admin', tab: 'trips' },
    webUrl: adminUrl('trips'),
  }
}

function openSupport() {
  return {
    id: 'open-ticket',
    label: 'Open ticket',
    method: 'GET',
    path: '/api/admin',
    query: { action: 'tickets' },
    navigate: { path: 'admin', tab: 'support' },
    webUrl: adminUrl('support'),
  }
}

function infoRequest(id, label, profileId, prompt) {
  return {
    id,
    label,
    method: 'POST',
    path: '/api/admin',
    query: { action: 'info-request' },
    body: { profileId, prompt },
  }
}

function makeItem({ kind, sourceId, title, detail, at, urgency, actions }) {
  const createdAt = at || null
  return {
    id: `${kind}:${sourceId}`,
    kind,
    sourceId: String(sourceId),
    title,
    detail,
    createdAt,
    urgency,
    actions,
  }
}

function withAge(item, now) {
  const ms = ageMs(item.createdAt, now)
  return { ...item, ageMs: ms, ageLabel: formatAge(ms) }
}

function docLabel(docType) {
  return String(docType || 'document').replace(/_/g, ' ')
}

export function inspectionPacketOnFile(documents) {
  const byType = new Map()
  for (const row of documents || []) {
    const type = row?.doc_type
    if (type && !byType.has(type)) byType.set(type, row)
  }
  const ready = (row) => Boolean(String(row?.storage_path || '').trim()) && norm(row?.review_status) !== 'rejected'
  if (!INSPECTION_PHOTOS.every((type) => ready(byType.get(type)))) return false
  const form = byType.get('inspection_form')
  return ready(form) && INSPECTION_SOURCES.has(String(form?.inspection_source || '').trim())
}

function holdAnchor(trip) {
  const meta = metaOf(trip)
  const hold = meta.payment_hold
  if (hold && typeof hold === 'object') {
    const status = norm(hold.status)
    if (status === 'payment_required' || status === 'failed' || status === 'canceled' || hold.code || hold.error || hold.lastError) {
      return when(hold.failedAt, hold.at, trip.updated_at, trip.created_at)
    }
  }
  const outstanding = meta.outstanding_balance
  if (outstanding && typeof outstanding === 'object' && outstanding.reason) {
    return when(outstanding.at, trip.updated_at, trip.created_at)
  }
  const fare = meta.fare_authorization
  if (fare && typeof fare === 'object') {
    const status = norm(fare.status)
    if (status === 'failed' || status === 'requires_payment_method' || status === 'canceled') {
      return when(fare.at, trip.updated_at, trip.created_at)
    }
  }
  return null
}

function holdDetail(trip) {
  const meta = metaOf(trip)
  const hold = meta.payment_hold
  if (hold && typeof hold === 'object') {
    const bits = [hold.status, hold.code, hold.error, hold.lastError].filter(Boolean)
    if (bits.length) return bits.join(' · ')
  }
  if (meta.outstanding_balance?.reason) return String(meta.outstanding_balance.reason)
  if (meta.fare_authorization?.status) return `fare authorization ${meta.fare_authorization.status}`
  return 'Stripe hold needs a look'
}

function payoutRecordProblem(record) {
  if (!record || typeof record !== 'object') return false
  if (norm(record.status) === 'failed') return true
  if (norm(record.status) === 'pending' && (record.lastError || Number(record.attempts) > 0)) return true
  return false
}

function stuckAnchor(trip, nowMs) {
  if (!trip || metaOf(trip).e2e_test === true) return null
  const status = norm(trip.status)
  if (status === 'scheduled') {
    const pickup = Date.parse(trip.pickup_at || trip.scheduled_for || '')
    if (Number.isFinite(pickup) && pickup <= nowMs) return when(trip.pickup_at, trip.scheduled_for, trip.created_at)
    return null
  }
  if (futureSchedule(trip, nowMs)) return null
  if (!STUCK_ACTIVE.has(status) && !STUCK_OPEN.has(status)) return null
  const anchor = when(trip.accepted_at, trip.requested_at, trip.created_at, trip.updated_at)
  if (!anchor || nowMs - Date.parse(anchor) < STUCK_AFTER_MS) return null
  return anchor
}

function flaggedTicket(ticket) {
  if (!ticket || norm(ticket.category) !== 'safety') return false
  if (norm(ticket.status) === 'resolved') return false
  const hay = `${ticket.subject || ''}\n${ticket.body || ''}`.toLowerCase()
  return hay.includes('report trip chat') || hay.includes('reported message')
}

function w9Complete(tax, w9, profile) {
  if (w9?.certified === true) return true
  if (norm(w9?.collection) === 'stripe' && profile?.stripe_details_submitted === true) return true
  if (profile?.stripe_details_submitted === true && profile?.stripe_payouts_enabled === true) return true
  const name = String(tax?.legal_name || w9?.legal_name || '').trim()
  const last4 = String(tax?.tin_last4 || w9?.tin_last4 || '')
  return name.length >= 2 && /^[0-9]{4}$/.test(last4)
}

function indexBy(rows, key) {
  const map = {}
  for (const row of rows || []) {
    const id = row?.[key]
    if (!id) continue
    if (!map[id]) map[id] = []
    map[id].push(row)
  }
  return map
}

/**
 * @param {object} input rows already loaded by the admin server
 * @param {Date|string|number} [now]
 */
export function buildAdminInbox(input = {}, now = new Date()) {
  const wall = now instanceof Date ? now : new Date(now)
  const nowMs = wall.getTime()
  const profiles = input.profiles || {}
  const items = []

  for (const doc of input.documents || []) {
    if (!isManualDocumentStatus(doc.review_status)) continue
    const name = person(profiles, doc.profile_id, 'Driver')
    const status = doc.review_status
    const bits = [status, doc.match_status, doc.review_note].filter(Boolean)
    items.push(makeItem({
      kind: 'document_review',
      sourceId: doc.id || `${doc.profile_id}:${doc.doc_type}`,
      title: `${docLabel(doc.doc_type)} · ${name}`,
      detail: bits.join(' · ') || 'Waiting for manual review',
      at: when(doc.created_at),
      urgency: URGENCY.document_review,
      actions: [
        openApplicant(doc.profile_id),
        infoRequest(
          'request-document',
          'Ask for a new upload',
          doc.profile_id,
          `Please re-upload your ${docLabel(doc.doc_type)}. It is in the manual review queue (${status}).`,
        ),
      ],
    }))
  }

  for (const photo of input.photos || []) {
    const status = photo.reviewStatus || photo.review_status
    if (!isPhotoReviewStatus(status)) continue
    const name = photo.name || person(profiles, photo.profileId || photo.profile_id, 'Driver')
    const reason = photo.aiReason || photo.ai_reason || 'Waiting for admin review'
    const profileId = photo.profileId || photo.profile_id
    const photoId = photo.id
    items.push(makeItem({
      kind: 'photo_review',
      sourceId: photoId,
      title: `Profile photo · ${name}`,
      detail: [status, reason].filter(Boolean).join(' · '),
      at: when(photo.createdAt, photo.created_at),
      urgency: URGENCY.photo_review,
      actions: [
        {
          id: 'approve-photo',
          label: 'Approve photo',
          method: 'POST',
          path: '/api/admin-drivers',
          body: { action: 'review-profile-photo', photoId, decision: 'approve' },
        },
        {
          id: 'reject-photo',
          label: 'Reject photo',
          method: 'POST',
          path: '/api/admin-drivers',
          body: { action: 'review-profile-photo', photoId, decision: 'reject' },
          needsReason: true,
          reasonField: 'reason',
          minReason: 3,
        },
        openApplicant(profileId),
      ],
    }))
  }

  for (const app of input.applications || []) {
    if (norm(app.onboarding_status) !== 'pending_review') continue
    const name = person(profiles, app.profile_id, 'Applicant')
    const at = when(app.submitted_at, app.created_at)
    const gate = backgroundGateFromApplication(app)
    items.push(makeItem({
      kind: 'driver_approval',
      sourceId: app.id || app.profile_id,
      title: `Approve driver · ${name}`,
      detail: gate.backgroundAuthorized
        ? 'Application is pending review'
        : 'Application is pending review. Background attestation is still missing.',
      at,
      urgency: URGENCY.driver_approval,
      actions: [
        {
          id: 'approve-driver',
          label: gate.backgroundStatus === 'needs_review' && !gate.backgroundReviewAcknowledged
            ? 'Approve and note disclosure'
            : 'Approve driver',
          method: 'POST',
          path: '/api/admin-drivers',
          body: {
            profileId: app.profile_id,
            decision: 'approve',
            ...(gate.backgroundStatus === 'needs_review' && !gate.backgroundReviewAcknowledged
              ? { acknowledgeBackgroundReview: true }
              : {}),
          },
        },
        {
          id: 'reject-driver',
          label: 'Reject driver',
          method: 'POST',
          path: '/api/admin-drivers',
          body: { profileId: app.profile_id, decision: 'reject' },
          needsReason: true,
          reasonField: 'reason',
          minReason: 3,
        },
        openApplicant(app.profile_id),
      ],
    }))
    if (!gate.backgroundAuthorized) {
      items.push(makeItem({
        kind: 'background_attestation',
        sourceId: app.profile_id,
        title: `Background attestation · ${name}`,
        detail: 'Pending applicant has not finished the background attestation',
        at,
        urgency: URGENCY.background_attestation,
        actions: [
          infoRequest(
            'request-background',
            'Ask for attestation',
            app.profile_id,
            'Finish the background attestation on your driver application. Authorized means you consented and disclosed. It is not a result from a screening company.',
          ),
          openApplicant(app.profile_id),
        ],
      }))
    }
  }

  const inspectionDocs = indexBy(input.inspectionDocuments || [], 'profile_id')
  for (const deadline of input.deadlines || []) {
    const dueMs = Date.parse(deadline.inspection_due_at || '')
    if (!Number.isFinite(dueMs)) continue
    if (dueMs > nowMs + INSPECTION_DUE_SOON_MS) continue
    const docs = inspectionDocs[deadline.profile_id] || []
    if (inspectionPacketOnFile(docs)) continue
    const overdue = dueMs <= nowMs
    const name = person(profiles, deadline.profile_id, 'Driver')
    const days = Math.max(1, Math.ceil(Math.abs(dueMs - nowMs) / (24 * 60 * 60 * 1000)))
    items.push(makeItem({
      kind: 'inspection',
      sourceId: deadline.profile_id,
      title: overdue ? `Inspection overdue · ${name}` : `Inspection due · ${name}`,
      detail: overdue ? `Overdue ${days === 1 ? '1 day' : `${days} days`}` : `Due in ${days === 1 ? '1 day' : `${days} days`}`,
      at: when(deadline.first_approved_at, deadline.inspection_due_at),
      urgency: overdue ? URGENCY.inspection_overdue : URGENCY.inspection_due,
      actions: [
        infoRequest(
          'request-inspection',
          'Ask for the inspection',
          deadline.profile_id,
          'Your vehicle inspection is due. Upload the four sides and the inspection form in the driver app.',
        ),
        openApplicant(deadline.profile_id),
      ],
    }))
  }

  for (const report of input.lostItems || []) {
    if (norm(report.status) !== 'open') continue
    items.push(makeItem({
      kind: 'lost_item',
      sourceId: report.id,
      title: `Lost item · ${person(profiles, report.reporter_id, report.reporter_role || 'Rider')}`,
      detail: String(report.description || 'Open lost-item report').slice(0, 180),
      at: when(report.opened_at, report.created_at),
      urgency: URGENCY.lost_item,
      actions: [openTrips()],
    }))
  }

  for (const ticket of input.tickets || []) {
    if (!flaggedTicket(ticket)) continue
    items.push(makeItem({
      kind: 'flagged_message',
      sourceId: ticket.id,
      title: ticket.subject || 'Flagged trip message',
      detail: String(ticket.body || ticket.escalation_reason || 'Safety report from trip chat').slice(0, 180),
      at: when(ticket.created_at),
      urgency: URGENCY.flagged_message,
      actions: [
        {
          id: 'resolve-report',
          label: 'Mark resolved',
          method: 'POST',
          path: '/api/admin',
          query: { action: 'ticket-reply' },
          body: { ticketId: ticket.id, status: 'resolved' },
          needsReason: true,
          reasonField: 'body',
          defaultReason: 'Reviewed the reported trip message.',
          minReason: 1,
        },
        openSupport(),
      ],
    }))
  }

  for (const trip of input.trips || []) {
    const holdAt = holdAnchor(trip)
    if (holdAt) {
      items.push(makeItem({
        kind: 'failed_hold',
        sourceId: trip.id,
        title: `Failed Stripe hold · ${tripLabel(trip)}`,
        detail: holdDetail(trip),
        at: holdAt,
        urgency: URGENCY.failed_hold,
        actions: [openTrips()],
      }))
    }
    const payout = metaOf(trip).payout
    const tip = metaOf(trip).tip_payout
    if (payoutRecordProblem(payout) || payoutRecordProblem(tip)) {
      const problem = payoutRecordProblem(payout) ? payout : tip
      const driverId = trip.driver_id
      const actions = [openTrips()]
      if (driverId) {
        actions.unshift(infoRequest(
          'request-payout',
          'Ask the driver to check payouts',
          driverId,
          'A payout on a completed trip needs attention. Open payouts in the driver app and confirm the bank account.',
        ))
      }
      items.push(makeItem({
        kind: 'payout_w9',
        sourceId: `trip:${trip.id}:${payoutRecordProblem(payout) ? 'payout' : 'tip'}`,
        title: `Payout problem · ${person(profiles, driverId, 'Driver')}`,
        detail: [problem.status, problem.lastError, tripLabel(trip)].filter(Boolean).join(' · '),
        at: when(problem.nextRetryAt, trip.updated_at, trip.created_at),
        urgency: URGENCY.payout_w9,
        actions,
      }))
    }
    const stuckAt = stuckAnchor(trip, nowMs)
    if (stuckAt) {
      items.push(makeItem({
        kind: 'stuck_trip',
        sourceId: trip.id,
        title: `Stuck trip · ${trip.status}`,
        detail: tripLabel(trip),
        at: stuckAt,
        urgency: URGENCY.stuck_trip,
        actions: [openTrips()],
      }))
    }
  }

  for (const event of input.payoutEvents || []) {
    if (norm(event.status) !== 'failed') continue
    const driverId = event.driver_id
    items.push(makeItem({
      kind: 'payout_w9',
      sourceId: `event:${event.id}`,
      title: `Payout failed · ${person(profiles, driverId, 'Driver')}`,
      detail: [event.event_type, event.amount_cents != null ? `${event.amount_cents} cents` : null].filter(Boolean).join(' · ') || 'Stripe payout failed',
      at: when(event.created_at, event.updated_at),
      urgency: URGENCY.payout_w9,
      actions: driverId
        ? [infoRequest(
          'request-payout-event',
          'Ask the driver to check payouts',
          driverId,
          'A Stripe payout failed. Open payouts in the driver app and confirm the bank account.',
        )]
        : [],
    }))
  }

  const taxByProfile = Object.fromEntries((input.taxRows || []).map((row) => [row.profile_id, row]))
  const w9ByProfile = Object.fromEntries((input.w9Rows || []).map((row) => [row.profile_id, row]))
  for (const driver of input.approvedDrivers || []) {
    const profile = profiles[driver.profile_id] || driver
    const tax = taxByProfile[driver.profile_id]
    const w9 = w9ByProfile[driver.profile_id]
    if (!w9Complete(tax, w9, profile)) {
      items.push(makeItem({
        kind: 'payout_w9',
        sourceId: `w9:${driver.profile_id}`,
        title: `W-9 missing · ${person(profiles, driver.profile_id, 'Driver')}`,
        detail: 'Approved driver is missing a usable W-9',
        at: when(driver.reviewed_at, driver.submitted_at, driver.created_at),
        urgency: URGENCY.payout_w9,
        actions: [
          infoRequest(
            'request-w9',
            'Ask for the W-9',
            driver.profile_id,
            'Payouts need a W-9 on file. Add your legal name and taxpayer information before the next payout.',
          ),
          openApplicant(driver.profile_id),
        ],
      }))
    }
    if (profile?.stripe_account_id && profile.stripe_payouts_enabled === false) {
      items.push(makeItem({
        kind: 'payout_w9',
        sourceId: `connect:${driver.profile_id}`,
        title: `Payouts disabled · ${person(profiles, driver.profile_id, 'Driver')}`,
        detail: 'Stripe Connect is on file and payouts are disabled',
        at: when(driver.reviewed_at, driver.created_at),
        urgency: URGENCY.payout_w9,
        actions: [
          infoRequest(
            'request-connect',
            'Ask them to finish Connect',
            driver.profile_id,
            'Stripe is not paying out to your account yet. Finish payout setup in the driver app.',
          ),
        ],
      }))
    }
  }

  const aged = items.map((item) => withAge(item, wall))
  aged.sort((a, b) => (b.urgency - a.urgency) || (b.ageMs - a.ageMs) || a.title.localeCompare(b.title))
  const counts = Object.fromEntries(INBOX_KINDS.map((kind) => [kind, 0]))
  for (const item of aged) counts[item.kind] += 1
  return {
    total: aged.length,
    counts,
    items: aged,
    asOf: wall.toISOString(),
  }
}

export function inboxActionRequest(action, { reason } = {}) {
  if (!action || typeof action !== 'object') return { error: 'Missing action' }
  const method = action.method || 'POST'
  const body = { ...(action.body || {}) }
  if (action.needsReason) {
    const text = String(reason ?? action.defaultReason ?? '').trim()
    const min = Number(action.minReason) > 0 ? Number(action.minReason) : 3
    if (text.length < min) {
      return { error: min > 1 ? 'Add a short reason first.' : 'Add a reply first.' }
    }
    body[action.reasonField || 'reason'] = text
  }
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(action.query || {})) {
    if (value != null && String(value) !== '') params.set(key, String(value))
  }
  const qs = params.toString()
  return {
    error: null,
    method,
    path: qs ? `${action.path}?${qs}` : action.path,
    body: method === 'GET' ? undefined : body,
    navigate: action.navigate || null,
    webUrl: action.webUrl || null,
  }
}

function tripLabel(trip) {
  const from = trip.pickup_label || 'Pickup'
  const to = trip.dropoff_label || 'Dropoff'
  return `${from} → ${to}`
}
