/**
 * Four-channel driver offer alerts.
 * Channels, and no others: in_app, push, sms, email.
 *
 * in_app is the existing driver-screen chime. It plays only while that screen
 * is open, so this module records the channel and does not play audio.
 * push posts to the Expo push API with or without EXPO_ACCESS_TOKEN.
 * The token is optional while Enhanced Security for Push is off; when set,
 * the request sends Authorization: Bearer. Lock-screen delivery still needs
 * APNs (iOS) or FCM (Android) on the Expo project. The client still shows
 * an in-app alert while online.
 * SMS and email delivery are delegated to driverOfferChannels.js.
 */
import { dispatchDriverOfferChannels } from './driverOfferChannels.js'
import { sendExpoPush, PUSH_CREDENTIAL_GAP } from './expoPush.js'
import { quietFromPrefs } from '../src/lib/quietHours.js'

export const DRIVER_OFFER_ALERT_CHANNELS = Object.freeze(['in_app', 'push', 'sms', 'email'])

function assertChannel(channel) {
  switch (channel) {
    case 'in_app':
    case 'push':
    case 'sms':
    case 'email':
      return channel
    default: {
      const unknown = channel
      throw new Error(`Unknown offer alert channel: ${String(unknown)}`)
    }
  }
}

function minutesInNewYork(now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const hour = Number(parts.find((part) => part.type === 'hour')?.value)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value)
  const normalizedHour = hour === 24 ? 0 : hour
  if (!Number.isFinite(normalizedHour) || !Number.isFinite(minute)) return 0
  return normalizedHour * 60 + minute
}

function toMinutes(hhmmValue) {
  const [h, m] = String(hhmmValue).split(':').map((n) => Number(n))
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0
  return h * 60 + m
}

/** Quiet hours follow Clemson local time, not the server's UTC clock. */
export function isQuietForDriverOffer(prefs, now = new Date()) {
  const quiet = quietFromPrefs(prefs)
  if (quiet.dnd) return true
  if (!quiet.scheduleEnabled) return false
  const mins = minutesInNewYork(now)
  const start = toMinutes(quiet.start)
  const end = toMinutes(quiet.end)
  if (start === end) return true
  if (start < end) return mins >= start && mins < end
  return mins >= start || mins < end
}

export function offerAlertCopy(trip) {
  const pickup = String(trip?.pickup_label || '').trim() || 'Pickup'
  const dropoff = String(trip?.dropoff_label || '').trim() || 'Drop-off'
  return {
    title: 'New ride request',
    body: `${pickup} → ${dropoff}`,
  }
}

function suppressedPlan(reason) {
  const channels = {}
  for (const channel of DRIVER_OFFER_ALERT_CHANNELS) {
    channels[assertChannel(channel)] = { sent: false, reason }
  }
  return channels
}

export function buildOfferAlertPlan({
  suppressed = null,
  pushTokenPresent = false,
  phoneOnFile = false,
  emailOnFile = false,
} = {}) {
  if (suppressed) return suppressedPlan(suppressed)
  const channels = {
    in_app: { sent: false, reason: 'open_driver_screen_only' },
    push: {
      sent: false,
      reason: pushTokenPresent ? 'push_not_sent' : 'push_token_missing',
      tokenPresent: Boolean(pushTokenPresent),
      gap: pushTokenPresent ? PUSH_CREDENTIAL_GAP : undefined,
    },
    sms: { sent: false, reason: 'sms_provider_missing', phoneOnFile: Boolean(phoneOnFile) },
    email: { sent: false, reason: emailOnFile ? 'live_send_disabled' : 'driver_email_missing' },
  }
  for (const channel of DRIVER_OFFER_ALERT_CHANNELS) assertChannel(channel)
  return channels
}

function readPushToken(statusRow, tokenRow) {
  const statusToken = String(statusRow?.expo_push_token || '').trim()
  const tableToken = String(tokenRow?.token || '').trim()
  return statusToken || tableToken
}

async function loadDriverContact(sb, driverId) {
  const profile = await sb.from('profiles').select('email, phone, notification_prefs').eq('id', driverId).maybeSingle()
  const status = await sb.from('driver_status').select('expo_push_token').eq('driver_id', driverId).maybeSingle()
  const token = await sb.from('driver_push_tokens').select('token, platform').eq('driver_id', driverId).maybeSingle()
  return {
    email: String(profile.data?.email || '').trim(),
    phone: String(profile.data?.phone || '').trim(),
    phoneOnFile: Boolean(String(profile.data?.phone || '').trim()),
    prefs: profile.data?.notification_prefs || null,
    pushToken: readPushToken(status.data, token.data),
    pushTokenPresent: Boolean(readPushToken(status.data, token.data)),
    error: profile.error || status.error || token.error || null,
  }
}

async function existingAlert(sb, tripId, driverId, offerMarker) {
  const prior = await sb.from('driver_offer_alerts')
    .select('channels')
    .eq('trip_id', tripId)
    .eq('driver_id', driverId)
    .eq('offer_marker', offerMarker)
    .maybeSingle()
  if (prior.error || !prior.data?.channels) return null
  return prior.data.channels
}

export async function dispatchDriverOfferAlert(sb, {
  trip,
  driverId,
  offerMarker,
  now = new Date(),
} = {}, deps = {}) {
  const tripId = trip?.id
  if (!sb || !tripId || !driverId || !offerMarker) {
    return { ok: false, reason: 'alert_target_missing', channels: null }
  }

  const stored = await existingAlert(sb, tripId, driverId, offerMarker)
  if (stored) {
    return { ok: true, tripId, driverId, offerMarker, channels: stored, recorded: true, duplicate: true }
  }

  const contact = await loadDriverContact(sb, driverId)
  let suppressed = null
  if (contact.prefs && contact.prefs.ride === false) suppressed = 'ride_alerts_off'
  else if (isQuietForDriverOffer(contact.prefs, now)) suppressed = 'quiet_hours'

  const channels = buildOfferAlertPlan({
    suppressed,
    pushTokenPresent: contact.pushTokenPresent,
    phoneOnFile: contact.phoneOnFile,
    emailOnFile: Boolean(contact.email),
  })

  const alerts = sb.from('driver_offer_alerts')
  const inserted = typeof alerts.insert === 'function'
    ? await alerts.insert({
      trip_id: tripId,
      driver_id: driverId,
      offer_marker: offerMarker,
      channels,
    })
    : { error: { message: 'driver_offer_alerts insert is unavailable' } }
  if (inserted?.error) {
    const raced = await existingAlert(sb, tripId, driverId, offerMarker)
    if (raced) return { ok: true, tripId, driverId, offerMarker, channels: raced, recorded: true, duplicate: true }
  }

  if (!inserted?.error && !suppressed && contact.pushToken) {
    const tier = trip?.tier || trip?.metadata?.ride_option || 'standard'
    const prefs = contact.prefs?.ride_alerts
    const mode = prefs && typeof prefs === 'object' ? prefs[tier] || prefs.standard : null
    const sound = mode === 'silent' || mode === 'vibrate' ? null : 'default'
    const pushed = await sendExpoPush({
      to: contact.pushToken,
      title: offerAlertCopy(trip).title,
      body: offerAlertCopy(trip).body,
      sound,
      data: { tripId, tier },
    }, deps)
    channels.push = {
      sent: Boolean(pushed.sent),
      reason: pushed.reason,
      tokenPresent: true,
      ...(pushed.gap ? { gap: pushed.gap } : {}),
    }
  }

  if (!inserted?.error && !suppressed) {
    const delivered = await dispatchDriverOfferChannels({
      sb, tripId, driverId, offerMarker, phone: contact.phone, email: contact.email,
      prefs: contact.prefs, suppressed, copy: offerAlertCopy(trip), now,
    }, deps)
    channels.sms = delivered.sms
    channels.email = delivered.email
    channels.sms.phoneOnFile = contact.phoneOnFile
    // The first insert is the cross-channel claim. This update is audit/display data only.
    try {
      const update = sb.from('driver_offer_alerts')
      if (typeof update.update === 'function') await update.update({ channels }).eq('trip_id', tripId).eq('driver_id', driverId).eq('offer_marker', offerMarker)
    } catch { /* delivery succeeded even when the compatibility update is unavailable */ }
  } else if (!inserted?.error && suppressed) {
    // Record SMS/email suppression attempts when the additive audit table exists.
    await dispatchDriverOfferChannels({ sb, tripId, driverId, offerMarker, phone: contact.phone, email: contact.email, prefs: contact.prefs, suppressed, copy: offerAlertCopy(trip), now }, deps)
  }
  return {
    ok: true,
    tripId,
    driverId,
    offerMarker,
    channels,
    recorded: !inserted?.error,
    duplicate: false,
  }
}

export async function notifyDriverOffer(sb, input, deps) {
  try {
    return await dispatchDriverOfferAlert(sb, input, deps)
  } catch (err) {
    console.error('[driver-offer-alert]', err?.message || err)
    return { ok: false, reason: 'alert_failed', channels: null }
  }
}
