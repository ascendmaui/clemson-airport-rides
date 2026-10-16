/**
 * Immediate account deletion for the signed-in rider or driver.
 * Cancels open rides, releases uncaptured card holds, cancels subscriptions,
 * strips profile contact data, and deletes the Supabase auth user.
 * Completed receipts, payouts, and tax rows stay on the anonymized profile.
 */
import { releaseOpenFareHold, markReleasedHoldPayment } from './fareAuthorization.js'
import { openPoolRerequestPatch } from '../shared/driverCancel.js'
import { revokeAppleToken } from './appleRevoke.js'

export const TRIP_IN_PROGRESS_ERROR = 'Finish the trip in progress before deleting your account.'
export const GUEST_DELETE_ERROR = 'Guest browsing does not have an account to delete.'
export const HOLD_RELEASE_ERROR = 'A card hold is still open and could not be released. Try again in a few minutes.'
export const SUBSCRIPTION_CANCEL_ERROR = 'A subscription is still active and could not be canceled. Try again in a few minutes.'
export const DELETED_NAME = 'Deleted account'
export const REMOVED_CHAT = 'Removed'

const OPEN_RIDE_STATUSES = ['requested', 'searching', 'offered', 'accepted', 'arriving', 'arrived', 'in_progress', 'scheduled']
const RELEASABLE_PAYMENT_STATUSES = new Set([
  'pending',
  'requires_capture',
  'requires_confirmation',
  'requires_action',
  'requires_payment_method',
])
const LIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due', 'paused', 'pending', 'incomplete'])
const TRIP_COLUMNS = 'id, status, rider_id, driver_id, metadata, fare_cents'

export function deletedEmail(userId) {
  return `deleted+${userId}@users.clemsonrides.invalid`
}

function userError(status, code, error) {
  const err = new Error(error)
  err.status = status
  err.code = code
  return err
}

function blocked(status, code, error) {
  return { ok: false, blocked: true, status, code, error }
}

function missingRelation(error) {
  const message = `${error?.message || ''} ${error?.details || ''} ${error?.code || ''}`
  return /does not exist|schema cache|could not find the table|PGRST205|42P01/i.test(message)
}

function mentionedColumn(error, patch) {
  const message = `${error?.message || ''} ${error?.details || ''}`
  if (!/column|schema cache|PGRST204|42703/i.test(message)) return null
  for (const key of Object.keys(patch)) {
    if (message.includes(key)) return key
  }
  return null
}

async function selectRows(sb, table, columns, filters, statusIn) {
  let query = sb.from(table).select(columns)
  for (const [key, value] of filters) query = query.eq(key, value)
  if (statusIn) query = query.in('status', statusIn)
  const result = await query
  if (result?.error) {
    if (missingRelation(result.error)) return []
    throw result.error
  }
  return result.data || []
}

async function writeRows(sb, table, patch, filters) {
  let next = { ...patch }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (!Object.keys(next).length) return { ok: true, skipped: true }
    let query = sb.from(table).update(next)
    for (const [key, value] of filters) query = query.eq(key, value)
    const result = await query
    if (!result?.error) return { ok: true }
    if (missingRelation(result.error)) return { ok: true, skipped: true }
    const column = mentionedColumn(result.error, next)
    if (!column) throw result.error
    delete next[column]
  }
  throw new Error(`Could not update ${table}`)
}

async function deleteRows(sb, table, filters) {
  let query = sb.from(table).delete()
  for (const [key, value] of filters) query = query.eq(key, value)
  const result = await query
  if (result?.error && !missingRelation(result.error)) throw result.error
  return { ok: true }
}

function realIntentId(value) {
  const id = String(value || '')
  if (!id || id.startsWith('local:') || id.startsWith('zero:') || id.startsWith('credits:')) return ''
  return id
}

function holdOnTrip(trip) {
  return trip?.metadata?.fare_authorization?.status === 'requires_capture'
    && Boolean(trip?.metadata?.fare_authorization?.paymentIntentId)
}

async function cancelIntent(stripe, paymentIntentId) {
  const id = realIntentId(paymentIntentId)
  if (!id) return { skipped: true }
  if (!stripe?.paymentIntents?.cancel) {
    throw userError(409, 'hold_release_failed', HOLD_RELEASE_ERROR)
  }
  try {
    const intent = stripe.paymentIntents.retrieve ? await stripe.paymentIntents.retrieve(id) : null
    if (intent && ['succeeded', 'canceled', 'processing'].includes(intent.status)) {
      return { skipped: true, status: intent.status }
    }
    await stripe.paymentIntents.cancel(id, {}, { idempotencyKey: `account_delete:${id}` })
    return { canceled: true }
  } catch (error) {
    const code = String(error?.code || '')
    const message = String(error?.message || '')
    if (code === 'resource_missing' || /already been canceled|status of canceled|cannot cancel/i.test(message)) {
      return { skipped: true }
    }
    console.error('[account-delete] payment intent', message)
    throw userError(409, 'hold_release_failed', HOLD_RELEASE_ERROR)
  }
}

async function releaseRiderHolds(sb, stripe, trip, releaseHold) {
  const payments = await selectRows(sb, 'payments', 'id, status, stripe_payment_intent_id, trip_id', [['trip_id', trip.id]])
  const openPayment = payments.some((row) => RELEASABLE_PAYMENT_STATUSES.has(row.status) && realIntentId(row.stripe_payment_intent_id))
  if ((holdOnTrip(trip) || openPayment) && !stripe?.paymentIntents?.cancel) {
    throw userError(409, 'hold_release_failed', HOLD_RELEASE_ERROR)
  }
  if (holdOnTrip(trip)) {
    const released = await releaseHold({ sb, stripe, trip, reason: 'account_deletion' })
    if (released?.ok === false) throw userError(409, 'hold_release_failed', HOLD_RELEASE_ERROR)
  }
  for (const payment of payments) {
    if (!RELEASABLE_PAYMENT_STATUSES.has(payment.status)) continue
    const result = await cancelIntent(stripe, payment.stripe_payment_intent_id)
    if (result.canceled) await markReleasedHoldPayment(sb, trip.id, payment.stripe_payment_intent_id)
  }
}

async function cancelRiderTrip(sb, stripe, trip, releaseHold) {
  await releaseRiderHolds(sb, stripe, trip, releaseHold)
  await writeRows(sb, 'trips', { status: 'canceled' }, [['id', trip.id]])
  await writeRows(sb, 'location_shares', { active: false }, [['trip_id', trip.id]])
}

async function releaseDriverTrip(sb, trip, nowIso) {
  const patch = trip.status === 'scheduled'
    ? { status: 'scheduled', driver_id: null }
    : openPoolRerequestPatch(trip, nowIso)
  await writeRows(sb, 'trips', patch, [['id', trip.id]])
  await writeRows(sb, 'location_shares', { active: false }, [['trip_id', trip.id]])
  await deleteRows(sb, 'trip_driver_locations', [['trip_id', trip.id], ['driver_id', trip.driver_id]])
}

async function cancelStripeSubscription(stripe, subscriptionId) {
  if (!subscriptionId) return { skipped: true }
  const cancel = stripe?.subscriptions?.cancel || stripe?.subscriptions?.del
  if (!cancel) throw userError(409, 'subscription_cancel_failed', SUBSCRIPTION_CANCEL_ERROR)
  try {
    await cancel.call(stripe.subscriptions, subscriptionId)
    return { canceled: true }
  } catch (error) {
    const code = String(error?.code || '')
    const message = String(error?.message || '')
    if (code === 'resource_missing' || /no such subscription|already canceled|status of canceled/i.test(message)) {
      return { skipped: true }
    }
    console.error('[account-delete] subscription', message)
    throw userError(409, 'subscription_cancel_failed', SUBSCRIPTION_CANCEL_ERROR)
  }
}

async function cancelSubscriptionRow(sb, stripe, table, userId) {
  const rows = await selectRows(sb, table, 'rider_id, status, stripe_subscription_id', [['rider_id', userId]])
  const row = rows[0]
  if (!row || !LIVE_SUBSCRIPTION_STATUSES.has(row.status)) {
    if (row?.stripe_subscription_id && row.status !== 'canceled') {
      await cancelStripeSubscription(stripe, row.stripe_subscription_id)
    }
    return
  }
  await cancelStripeSubscription(stripe, row.stripe_subscription_id)
  await writeRows(sb, table, { status: 'canceled', cancel_at_period_end: false }, [['rider_id', userId]])
}

async function scrubProfile(sb, stripe, userId) {
  const rows = await selectRows(sb, 'profiles', 'id, stripe_customer_id', [['id', userId]])
  const customerId = rows[0]?.stripe_customer_id || null
  if (customerId && stripe?.customers?.update) {
    try {
      await stripe.customers.update(customerId, {
        email: deletedEmail(userId),
        name: DELETED_NAME,
        phone: '',
      })
    } catch (error) {
      console.error('[account-delete] stripe customer', error?.message || error)
    }
  }
  await writeRows(sb, 'profiles', {
    full_name: DELETED_NAME,
    email: deletedEmail(userId),
    phone: null,
    bio: null,
    avatar_url: null,
    favorite_spots: [],
    expo_push_token: null,
    ride_style: null,
    music_taste: null,
    favorite_driver_ids: [],
    stripe_default_pm_id: null,
  }, [['id', userId]])
}

async function scrubPii(sb, userId) {
  await deleteRows(sb, 'rider_push_tokens', [['rider_id', userId]])
  await deleteRows(sb, 'driver_push_tokens', [['driver_id', userId]])
  await deleteRows(sb, 'saved_places', [['user_id', userId]])
  await deleteRows(sb, 'emergency_contacts', [['user_id', userId]])
  await deleteRows(sb, 'community_profiles', [['user_id', userId]])
  await writeRows(sb, 'trip_messages', { body: REMOVED_CHAT }, [['sender_id', userId]])
  await writeRows(sb, 'lost_found_messages', { body: REMOVED_CHAT }, [['sender_id', userId]])
  await writeRows(sb, 'support_tickets', {
    subject: 'Account deleted',
    body: 'This account was deleted. The message was removed.',
  }, [['user_id', userId]])
  await writeRows(sb, 'driver_applications', { applicant_email: null }, [['profile_id', userId]])
  await writeRows(sb, 'driver_status', { online: false, expo_push_token: null }, [['driver_id', userId]])
  await writeRows(sb, 'driver_w9', {
    address_line: 'Retained for tax records',
    business_name: null,
    signature_name: null,
  }, [['profile_id', userId]])
  await writeRows(sb, 'driver_mileage_logs', { pickup_label: null, dropoff_label: null }, [['driver_id', userId]])
}

async function removeAuthUser(sb, userId) {
  if (typeof sb?.auth?.admin?.deleteUser !== 'function') {
    throw userError(500, 'auth_delete_unavailable', 'Could not delete the account. Try again.')
  }
  const result = await sb.auth.admin.deleteUser(userId)
  const error = result?.error
  if (!error) return { deleted: true }
  const message = String(error.message || error)
  if (/not found|user not found/i.test(message) || error.status === 404 || error.code === 'user_not_found') {
    return { deleted: true, idempotent: true }
  }
  console.error('[account-delete] auth user', message)
  throw userError(500, 'auth_delete_failed', 'Could not delete the account. Try again.')
}

export async function deleteAccount(sb, user, deps = {}) {
  if (!user?.id) throw userError(401, 'auth', 'Sign in required')
  if (user.is_anonymous === true || user.app_metadata?.provider === 'anonymous') {
    return blocked(403, 'guest', GUEST_DELETE_ERROR)
  }
  const now = deps.now instanceof Date ? deps.now : new Date()
  const nowIso = now.toISOString()
  const stripe = deps.stripe ?? null
  const releaseHold = deps.releaseHold || releaseOpenFareHold

  const [asRider, asDriver] = await Promise.all([
    selectRows(sb, 'trips', TRIP_COLUMNS, [['rider_id', user.id]], OPEN_RIDE_STATUSES),
    selectRows(sb, 'trips', TRIP_COLUMNS, [['driver_id', user.id]], OPEN_RIDE_STATUSES),
  ])
  if (asDriver.some((trip) => trip.status === 'in_progress' && trip.driver_id === user.id && trip.rider_id !== user.id)) {
    return blocked(409, 'trip_in_progress', TRIP_IN_PROGRESS_ERROR)
  }
  if (asDriver.some((trip) => trip.status === 'in_progress' && trip.driver_id === user.id)) {
    return blocked(409, 'trip_in_progress', TRIP_IN_PROGRESS_ERROR)
  }

  const riderIds = new Set(asRider.map((trip) => trip.id))
  for (const trip of asRider) {
    if (!OPEN_RIDE_STATUSES.includes(trip.status)) continue
    await cancelRiderTrip(sb, stripe, trip, releaseHold)
  }
  for (const trip of asDriver) {
    if (riderIds.has(trip.id) || trip.status === 'in_progress') continue
    if (!OPEN_RIDE_STATUSES.includes(trip.status)) continue
    await releaseDriverTrip(sb, trip, nowIso)
  }

  await cancelSubscriptionRow(sb, stripe, 'rider_subscriptions', user.id)
  await cancelSubscriptionRow(sb, stripe, 'student_plan_subscriptions', user.id)
  await scrubProfile(sb, stripe, user.id)
  await scrubPii(sb, user.id)
  const apple = await revokeAppleToken(user, {
    env: deps.env || process.env,
    fetch: deps.fetch,
    now: Math.floor(now.getTime() / 1000),
    warn: deps.warn || console.warn,
  })
  const auth = await removeAuthUser(sb, user.id)
  return { ok: true, deleted: true, idempotent: Boolean(auth.idempotent), apple }
}
