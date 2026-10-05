/** Server-only SMS/email delivery for driver offers. No push code lives here. */
const CHANNELS = ['sms', 'email']

function enabled(channel) { return (process.env[`DRIVER_OFFER_ALERT_${channel.toUpperCase()}`] || '').trim() === 'send' }
function limit(channel) {
  const value = Number(process.env[`DRIVER_OFFER_ALERT_${channel.toUpperCase()}_MAX_PER_HOUR`])
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 6
}
function providerConfigured(channel) {
  if (channel === 'sms') return Boolean((process.env.TWILIO_ACCOUNT_SID || '').trim() && (process.env.TWILIO_AUTH_TOKEN || '').trim() && ((process.env.TWILIO_FROM_NUMBER || '').trim() || (process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim()))
  return Boolean((process.env.RESEND_API_KEY || '').trim() && (process.env.RESEND_FROM || '').trim())
}
function optOut(prefs, channel) { return prefs?.[`offer_${channel}`] === false }
function cleanError(error) { return String(error?.message || error || 'provider request failed').slice(0, 500) }

async function insertAttempt(sb, row) {
  try {
    const table = sb?.from?.('driver_offer_alert_attempts')
    if (!table || typeof table.insert !== 'function') return { claimed: true, unsupported: true }
    const result = await table.insert(row)
    if (result?.error) return { claimed: false, error: result.error }
    return { claimed: true }
  } catch (error) { return { claimed: true, unsupported: true, error } }
}
async function finishAttempt(sb, identity, patch) {
  try {
    const q = sb?.from?.('driver_offer_alert_attempts')
    if (q && typeof q.update === 'function') await q.update(patch).eq('trip_id', identity.trip_id).eq('driver_id', identity.driver_id).eq('offer_marker', identity.offer_marker).eq('channel', identity.channel)
  } catch { /* attempt audit must never break offers */ }
}
async function countRecent(sb, driverId, channel, since) {
  try {
    const q = sb?.from?.('driver_offer_alert_attempts')
    if (!q || typeof q.select !== 'function' || typeof q.gte !== 'function') return 0
    const result = await q.select('id, status').eq('driver_id', driverId).eq('channel', channel).gte('created_at', since.toISOString())
    // Only real delivery attempts count toward the cap; skipped/rate-limited rows do not.
    return result?.error ? 0 : (result?.data || []).filter((row) => row?.status === 'pending' || row?.status === 'sent').length
  } catch { return 0 }
}

export async function sendTwilioOfferSms({ to, text }, deps = {}) {
  const fetcher = deps.fetch || globalThis.fetch
  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim()
  const token = (process.env.TWILIO_AUTH_TOKEN || '').trim()
  const from = (process.env.TWILIO_FROM_NUMBER || '').trim()
  const service = (process.env.TWILIO_MESSAGING_SERVICE_SID || '').trim()
  const body = new URLSearchParams({ To: to, Body: text })
  if (service) body.set('MessagingServiceSid', service); else body.set('From', from)
  const res = await fetcher(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Twilio failed (${res.status}): ${json.message || 'SMS not sent'}`)
  return { id: json.sid || null }
}

export async function sendResendOfferEmail({ to, subject, text }, deps = {}) {
  const fetcher = deps.fetch || globalThis.fetch
  const res = await fetcher('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${(process.env.RESEND_API_KEY || '').trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: (process.env.RESEND_FROM || '').trim(), to: [to], subject, text }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Resend failed (${res.status}): ${json.message || json.error || 'email not sent'}`)
  return { id: json.id || null }
}

export async function dispatchDriverOfferChannels({ sb, tripId, driverId, offerMarker, phone, email, prefs, suppressed, copy, now = new Date() }, deps = {}) {
  const output = {}
  for (const channel of CHANNELS) {
    const target = channel === 'sms' ? phone : email
    let reason = suppressed || (optOut(prefs, channel) ? `${channel}_opted_out` : null) || (!enabled(channel) ? 'live_send_disabled' : null) || (!target ? `driver_${channel === 'sms' ? 'phone' : 'email'}_missing` : null) || (!providerConfigured(channel) ? `${channel}_provider_credentials_missing` : null)
    const identity = { trip_id: tripId, driver_id: driverId, offer_marker: offerMarker, channel }
    if (!reason && await countRecent(sb, driverId, channel, new Date(now.getTime() - 60 * 60 * 1000)) >= limit(channel)) reason = 'rate_limited'
    const claim = await insertAttempt(sb, { ...identity, status: reason ? 'skipped' : 'pending', reason, created_at: now.toISOString() })
    if (!claim.claimed) { output[channel] = { sent: false, reason: 'duplicate_attempt' }; continue }
    if (reason) { output[channel] = { sent: false, reason }; continue }
    try {
      const payload = channel === 'sms' ? { to: target, text: `${copy.body}. Open the driver screen to accept or pass.` } : { to: target, subject: copy.title, text: `${copy.body}\nOpen the driver screen to accept or pass.` }
      const sender = channel === 'sms' ? (deps.sendSms || sendTwilioOfferSms) : (deps.sendEmail || sendResendOfferEmail)
      const result = await sender(payload, deps)
      await finishAttempt(sb, identity, { status: 'sent', reason: null, provider_message_id: result?.id || null, error: null })
      output[channel] = { sent: true, reason: null }
    } catch (error) {
      const message = cleanError(error)
      await finishAttempt(sb, identity, { status: 'failed', reason: 'provider_error', error: message })
      output[channel] = { sent: false, reason: 'provider_error' }
    }
  }
  return output
}
