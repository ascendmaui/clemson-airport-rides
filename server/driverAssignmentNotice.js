/**
 * Tell the assigned driver, and nobody else, that a ride was assigned.
 * Four channels: Resend email, an in-app driver_notifications row, Web Push,
 * and the existing Expo token path that delivers APNs on iOS.
 * Rider addresses are never recipients.
 */
import webpush from 'web-push'
import { sendApplicantNotice } from './applicantMail.js'
import { assignmentCopy, normalizeDriverEmail } from './defaultDrivers.js'

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

/**
 * driver_status.expo_push_token has no platform column. That is the token
 * registerDriverPush stores for the native driver app, including iOS APNs
 * via Expo. Dropping it would drop iOS. Rows stored with platform android
 * are not sent; Android native push is not a separate channel.
 */
export function tokensForIosAssignmentPush({ statusToken, rows } = {}) {
  const list = []
  if (statusToken) {
    list.push({ token: String(statusToken), platform: null, source: 'driver_status' })
  }
  for (const row of rows || []) {
    const token = row?.token || row?.expo_push_token
    if (!token) continue
    const platform = String(row.platform || '').toLowerCase()
    if (platform === 'android') continue
    list.push({
      token: String(token),
      platform: platform || null,
      source: 'driver_push_tokens',
    })
  }
  const seen = new Set()
  return list.filter((item) => {
    if (seen.has(item.token)) return false
    seen.add(item.token)
    return true
  })
}

function vapidConfig(env) {
  const publicKey = String(env.VAPID_PUBLIC_KEY || env.VITE_VAPID_PUBLIC_KEY || '').trim()
  const privateKey = String(env.VAPID_PRIVATE_KEY || '').trim()
  const subject = String(env.VAPID_SUBJECT || 'mailto:johnmatveyev@gmail.com').trim()
  return { publicKey, privateKey, subject }
}

async function defaultSendWebPush(subscription, payload, env) {
  const vapid = vapidConfig(env)
  if (!vapid.publicKey || !vapid.privateKey) {
    return { ok: false, reason: 'vapid_unconfigured' }
  }
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey)
  await webpush.sendNotification(subscription, payload)
  return { ok: true }
}

async function sendAssignmentEmail(driverEmail, copy, sendMail) {
  if (!driverEmail) {
    return { attempted: false, to: null, emailed: false, reason: 'driver_email_missing' }
  }
  const result = await sendMail({
    to: driverEmail,
    subject: copy.title,
    text: copy.body,
  })
  return {
    attempted: true,
    to: driverEmail,
    emailed: Boolean(result?.emailed),
    id: result?.id || null,
    reason: result?.todo || null,
  }
}

async function insertInAppNotice(sb, driverId, tripId, copy) {
  const inserted = await sb.from('driver_notifications').insert({
    driver_id: driverId,
    kind: 'ride_assigned',
    title: copy.title,
    body: copy.body,
    trip_id: tripId || null,
  })
  const error = inserted?.error?.message || null
  return { inserted: !error, driverId, error }
}

async function sendWebPushes(sb, driverId, copy, tripId, env, sendWebPush) {
  const listed = await sb
    .from('driver_web_push')
    .select('endpoint, p256dh, auth')
    .eq('driver_id', driverId)
  if (listed?.error) {
    return { attempted: false, endpoints: [], error: listed.error.message || 'web push lookup failed' }
  }
  const rows = Array.isArray(listed?.data) ? listed.data : []
  const payload = JSON.stringify({
    title: copy.title,
    body: copy.body,
    tripId: tripId || null,
    kind: 'ride_assigned',
  })
  const endpoints = []
  for (const row of rows) {
    if (!row?.endpoint || !row?.p256dh || !row?.auth) continue
    const subscription = {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
    }
    try {
      const sent = await sendWebPush(subscription, payload, env)
      endpoints.push({ endpoint: row.endpoint, ok: Boolean(sent?.ok), reason: sent?.reason || null })
    } catch (err) {
      endpoints.push({ endpoint: row.endpoint, ok: false, reason: err?.message || 'web push failed' })
    }
  }
  return { attempted: rows.length > 0, endpoints }
}

async function sendIosPushes(sb, driverId, copy, tripId, fetchImpl) {
  const [statusRes, tableRes] = await Promise.all([
    sb.from('driver_status').select('expo_push_token').eq('driver_id', driverId).maybeSingle(),
    sb.from('driver_push_tokens').select('token, platform').eq('driver_id', driverId),
  ])
  const tokens = tokensForIosAssignmentPush({
    statusToken: statusRes?.data?.expo_push_token || null,
    rows: Array.isArray(tableRes?.data) ? tableRes.data : [],
  })
  if (!tokens.length) {
    return {
      attempted: false,
      tokens: [],
      error: statusRes?.error?.message || tableRes?.error?.message || null,
    }
  }
  const messages = tokens.map((item) => ({
    to: item.token,
    title: copy.title,
    body: copy.body,
    data: { tripId: tripId || null, kind: 'ride_assigned' },
    sound: 'default',
    priority: 'high',
  }))
  try {
    const res = await fetchImpl(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    })
    const body = await res.json().catch(() => ({}))
    return {
      attempted: true,
      ok: Boolean(res.ok),
      tokens: tokens.map((item) => ({ token: item.token, source: item.source, platform: item.platform })),
      status: res.status,
      error: res.ok ? null : (body?.errors?.[0]?.message || `Expo push failed (${res.status})`),
    }
  } catch (err) {
    return {
      attempted: true,
      ok: false,
      tokens: tokens.map((item) => item.token),
      error: err?.message || 'Expo push failed',
    }
  }
}

/**
 * Notify the assigned driver on email, in-app, Web Push, and iOS APNs (Expo).
 * `riderEmail` is ignored. Nothing in the report is addressed to a rider.
 */
export async function notifyAssignedDriver(sb, input, deps = {}) {
  const driverId = String(input?.driverId || '').trim()
  const driverEmail = normalizeDriverEmail(input?.email)
  const trip = input?.trip || {}
  const tripId = trip.id || null
  const copy = assignmentCopy(trip)
  const sendMail = deps.sendMail || sendApplicantNotice
  const fetchImpl = deps.fetch || fetch
  const sendWebPush = deps.sendWebPush || defaultSendWebPush
  const env = deps.env || process.env

  if (!driverId) {
    return { riderNotified: false, driverId: null, skipped: 'no_driver' }
  }

  const email = await sendAssignmentEmail(driverEmail, copy, sendMail).catch((err) => ({
    attempted: true,
    to: driverEmail || null,
    emailed: false,
    reason: err?.message || 'email failed',
  }))
  const inApp = await insertInAppNotice(sb, driverId, tripId, copy).catch((err) => ({
    inserted: false,
    driverId,
    error: err?.message || 'in-app insert failed',
  }))
  const webPush = await sendWebPushes(sb, driverId, copy, tripId, env, sendWebPush).catch((err) => ({
    attempted: false,
    endpoints: [],
    error: err?.message || 'web push failed',
  }))
  const iosPush = await sendIosPushes(sb, driverId, copy, tripId, fetchImpl).catch((err) => ({
    attempted: false,
    tokens: [],
    error: err?.message || 'ios push failed',
  }))

  return {
    riderNotified: false,
    driverId,
    driverEmail,
    email,
    inApp,
    webPush,
    iosPush,
  }
}

/** Best-effort. A notification failure does not undo the ride. */
export async function notifyPreparedAssignment(sb, prepared, trip) {
  if (!prepared?.choice?.driverId) return null
  try {
    return await notifyAssignedDriver(sb, {
      driverId: prepared.choice.driverId,
      email: prepared.choice.email,
      trip: { ...(prepared.row || {}), ...(trip || {}) },
    })
  } catch (err) {
    console.warn('[default-driver] notify', err?.message || err)
    return null
  }
}
