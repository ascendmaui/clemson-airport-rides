/** Published CUPD non-emergency dispatch. Emergencies use 911. */
export const CUPD_PHONE_E164 = '+18646562222'
export const CUPD_PHONE_DISPLAY = '(864) 656-2222'
export const CUPD_EMAIL = 'police@clemson.edu'

export const ACTIVE_RIDE_STATUSES = ['accepted', 'arriving', 'in_progress']

export const SOS_CHANNELS = ['tel_911', 'tel_cupd', 'sms', 'mailto', 'web_share', 'banner']

export function isActiveRideStatus(status) {
  return ACTIVE_RIDE_STATUSES.includes(status)
}

export function buildSosText({ lat, lng, tripId }) {
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng)
  const coordText = hasCoords
    ? `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`
    : 'GPS unavailable'
  const lines = [
    'SOS Clemson RIDES',
    `Trip: ${tripId || 'unknown'}`,
    `Location: ${coordText}`,
  ]
  if (hasCoords) {
    lines.push(`https://maps.google.com/maps?q=${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`)
  }
  lines.push('Active campus ride. Need help now.')
  return lines.join('\n')
}

export function sosChannelHref(channel, text) {
  switch (channel) {
    case 'tel_911':
      return 'tel:911'
    case 'tel_cupd':
      return `tel:${CUPD_PHONE_E164}`
    case 'sms':
      return `sms:911?&body=${encodeURIComponent(text)}`
    case 'mailto':
      return `mailto:${CUPD_EMAIL}?subject=${encodeURIComponent('SOS Clemson RIDES')}&body=${encodeURIComponent(text)}`
    case 'web_share':
    case 'banner':
      return null
    default: {
      const unknown = channel
      throw new Error(`Unknown SOS channel: ${String(unknown)}`)
    }
  }
}

export function sosChannelButton(channel) {
  switch (channel) {
    case 'tel_911':
      return { title: 'Call 911', detail: 'Emergency voice call' }
    case 'tel_cupd':
      return { title: 'Call Clemson Police', detail: `${CUPD_PHONE_DISPLAY} · campus safety` }
    case 'sms':
      return { title: 'Text 911', detail: 'Lat/lng and trip id · main campus' }
    case 'mailto':
      return { title: 'Email Clemson Police', detail: CUPD_EMAIL }
    case 'web_share':
      return { title: 'Share location', detail: 'Share sheet with lat/lng and trip id' }
    case 'banner':
      return { title: 'Alert the other person', detail: 'In-app banner on this trip' }
    default: {
      const unknown = channel
      throw new Error(`Unknown SOS channel: ${String(unknown)}`)
    }
  }
}

export function sosChannelPhrase(channel) {
  switch (channel) {
    case 'tel_911':
      return 'called 911'
    case 'tel_cupd':
      return 'called Clemson Police'
    case 'sms':
      return 'texted 911 with their location'
    case 'mailto':
      return 'emailed Clemson Police'
    case 'web_share':
      return 'shared their live location'
    case 'banner':
      return 'sent an in-app SOS'
    default: {
      const unknown = channel
      return `activated SOS (${String(unknown)})`
    }
  }
}

export async function shareSosText(text) {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: 'SOS Clemson RIDES', text })
      return 'shared'
    } catch (err) {
      if (err && err.name === 'AbortError') return 'dismissed'
    }
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text)
    return 'copied'
  }
  return 'unavailable'
}
