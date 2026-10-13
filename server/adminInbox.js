/**
 * Loads the admin to-do inbox with the service role.
 * Callers must already have passed the admin role check.
 */
import { buildAdminInbox, isManualDocumentStatus } from '../shared/adminInbox.js'

const MISSING_TABLE = /schema cache|does not exist|could not find the table/i
const MISSING_COLUMN = /column|schema cache/i

const DOC_STATUSES = [
  'pending',
  'pending_manual_review',
  'manual_review',
  'manual-review',
  'needs_review',
  'pending_admin_review',
]
const PHOTO_STATUSES = ['pending_admin_review', 'pending_manual_review']
const INSPECTION_TYPES = [
  'inspection_front',
  'inspection_back',
  'inspection_left',
  'inspection_right',
  'inspection_interior',
  'inspection_form',
]

function missingTable(error) {
  return MISSING_TABLE.test(error?.message || '')
}

function missingColumn(error) {
  return MISSING_COLUMN.test(error?.message || '')
}

async function firstRows(attempts) {
  let lastError = null
  for (const attempt of attempts) {
    let result
    try {
      result = await attempt()
    } catch (err) {
      return { rows: [], missing: false, error: err?.message || 'query failed' }
    }
    if (!result?.error) return { rows: result.data || [], missing: false }
    lastError = result.error
    if (missingTable(result.error)) return { rows: [], missing: true }
    if (!missingColumn(result.error)) {
      return { rows: [], missing: false, error: result.error.message }
    }
  }
  if (lastError && (missingTable(lastError) || missingColumn(lastError))) {
    return { rows: [], missing: true }
  }
  return { rows: [], missing: false, error: lastError?.message || 'query failed' }
}

async function profilesById(sb, ids) {
  const unique = [...new Set(ids.filter(Boolean))]
  if (!unique.length) return {}
  const rich = await firstRows([
    () => sb.from('profiles').select('id, full_name, email, role, stripe_account_id, stripe_payouts_enabled, stripe_details_submitted').in('id', unique),
    () => sb.from('profiles').select('id, full_name, email, role').in('id', unique),
  ])
  return Object.fromEntries((rich.rows || []).map((row) => [row.id, row]))
}

export async function loadAdminInbox(sb, now = new Date()) {
  const errors = []
  const missing = []
  const note = (label, result) => {
    if (result.missing) missing.push(label)
    if (result.error) errors.push(`${label}: ${result.error}`)
    return result.rows || []
  }

  const [documents, photos, applications, deadlines, lostItems, tickets, trips, payoutEvents, approvedDrivers] = await Promise.all([
    firstRows([
      () => sb.from('driver_documents')
        .select('id, profile_id, doc_type, review_status, match_status, review_note, created_at')
        .in('review_status', DOC_STATUSES)
        .order('created_at', { ascending: true })
        .limit(40),
      () => sb.from('driver_documents')
        .select('id, profile_id, doc_type, review_status, created_at')
        .limit(40),
    ]),
    firstRows([
      () => sb.from('driver_profile_photos')
        .select('id, profile_id, review_status, ai_reason, created_at')
        .in('review_status', PHOTO_STATUSES)
        .order('created_at', { ascending: true })
        .limit(40),
    ]),
    firstRows([
      () => sb.from('driver_applications')
        .select('id, profile_id, onboarding_status, submitted_at, created_at, reviewed_at, background_authorized_at, background_check_status, background_admin_reviewed_at')
        .eq('onboarding_status', 'pending_review')
        .limit(40),
      () => sb.from('driver_applications')
        .select('id, profile_id, onboarding_status, submitted_at, created_at, background_authorized_at')
        .eq('onboarding_status', 'pending_review')
        .limit(40),
    ]),
    firstRows([
      () => sb.from('driver_inspection_deadlines')
        .select('profile_id, first_approved_at, inspection_due_at')
        .order('inspection_due_at', { ascending: true })
        .limit(80),
    ]),
    firstRows([
      () => sb.from('trip_lost_item_reports')
        .select('id, trip_id, reporter_id, reporter_role, description, status, opened_at')
        .eq('status', 'open')
        .limit(40),
    ]),
    firstRows([
      () => sb.from('support_tickets')
        .select('id, user_id, category, subject, body, status, created_at')
        .eq('category', 'safety')
        .limit(40),
    ]),
    firstRows([
      () => sb.from('trips')
        .select('id, status, rider_id, driver_id, pickup_label, dropoff_label, created_at, updated_at, accepted_at, requested_at, pickup_at, scheduled_for, metadata')
        .order('created_at', { ascending: false })
        .limit(120),
      () => sb.from('trips')
        .select('id, status, rider_id, driver_id, pickup_label, dropoff_label, created_at, metadata')
        .limit(120),
    ]),
    firstRows([
      () => sb.from('driver_payout_events')
        .select('id, driver_id, event_type, amount_cents, status, created_at, updated_at')
        .eq('status', 'failed')
        .limit(40),
    ]),
    firstRows([
      () => sb.from('driver_applications')
        .select('id, profile_id, onboarding_status, submitted_at, created_at, reviewed_at')
        .eq('onboarding_status', 'approved')
        .limit(80),
    ]),
  ])

  const docs = note('documents', documents).filter((row) => isManualDocumentStatus(row.review_status))
  const photoRows = note('photos', photos)
  const pendingApps = note('applications', applications)
  const deadlineRows = note('inspections', deadlines)
  const lost = note('lost items', lostItems)
  const safetyTickets = note('flagged messages', tickets)
  const tripRows = note('trips', trips)
  const failedPayouts = note('payouts', payoutEvents)
  const approved = note('w9', approvedDrivers)

  const inspectionIds = deadlineRows.map((row) => row.profile_id).filter(Boolean)
  const approvedIds = approved.map((row) => row.profile_id).filter(Boolean)
  const [inspectionDocuments, taxRows, w9Rows] = await Promise.all([
    inspectionIds.length
      ? firstRows([
        () => sb.from('driver_documents')
          .select('id, profile_id, doc_type, storage_path, review_status, inspection_source')
          .in('profile_id', inspectionIds),
        () => sb.from('driver_documents')
          .select('id, profile_id, doc_type, storage_path, review_status')
          .in('profile_id', inspectionIds),
      ])
      : Promise.resolve({ rows: [] }),
    approvedIds.length
      ? firstRows([
        () => sb.from('driver_tax_info')
          .select('profile_id, legal_name, tin_last4, updated_at')
          .in('profile_id', approvedIds),
      ])
      : Promise.resolve({ rows: [] }),
    approvedIds.length
      ? firstRows([
        () => sb.from('driver_w9')
          .select('profile_id, legal_name, tin_last4, certified, collection, updated_at')
          .in('profile_id', approvedIds),
      ])
      : Promise.resolve({ rows: [] }),
  ])
  const inspectionDocs = note('inspection documents', inspectionDocuments)
    .filter((row) => INSPECTION_TYPES.includes(row.doc_type))
  const taxes = note('tax', taxRows)
  const w9 = note('w9 form', w9Rows)

  const ids = [
    ...docs.map((row) => row.profile_id),
    ...photoRows.map((row) => row.profile_id),
    ...pendingApps.map((row) => row.profile_id),
    ...deadlineRows.map((row) => row.profile_id),
    ...lost.map((row) => row.reporter_id),
    ...tripRows.flatMap((row) => [row.rider_id, row.driver_id]),
    ...failedPayouts.map((row) => row.driver_id),
    ...approvedIds,
  ]
  const profiles = await profilesById(sb, ids)
  const built = buildAdminInbox({
    documents: docs,
    photos: photoRows.map((row) => ({
      id: row.id,
      profileId: row.profile_id,
      reviewStatus: row.review_status,
      aiReason: row.ai_reason,
      createdAt: row.created_at,
      name: profiles[row.profile_id]?.full_name || null,
    })),
    applications: pendingApps,
    deadlines: deadlineRows,
    inspectionDocuments: inspectionDocs,
    lostItems: lost,
    tickets: safetyTickets,
    trips: tripRows,
    payoutEvents: failedPayouts,
    approvedDrivers: approved,
    taxRows: taxes,
    w9Rows: w9,
    profiles,
  }, now)

  return {
    ...built,
    migrationRequired: missing.length > 0,
    partial: errors.length > 0,
    errors,
  }
}
