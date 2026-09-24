import { depositReceiptLines } from '../../packages/rides-native/riderMoney.js'
import { maskCompletedTripForDriver } from './privacyDisplay.js'

export function money(cents) {
  return (Number(cents) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export function buildReceiptText(trip, { forDriver = false } = {}) {
  if (!trip) return 'Clemson RIDES receipt'
  const view = forDriver ? maskCompletedTripForDriver(trip) : trip
  const fare = Number(trip.fare_cents) || 0
  const tip = Number(trip.tip_cents) || 0
  const when = trip.completed_at
    ? new Date(trip.completed_at).toLocaleString()
    : ''
  return [
    'Clemson RIDES receipt',
    `Trip ${trip.id}`,
    `From: ${view.pickup_label || 'Pickup'}`,
    `To: ${view.dropoff_label || 'Dropoff'}`,
    when ? `Completed: ${when}` : null,
    `Fare: ${money(fare)}`,
    ...depositReceiptLines(trip),
    `Tip: ${money(tip)}`,
    `Total: ${money(fare + tip)}`,
  ].filter(Boolean).join('\n')
}

export async function shareReceipt(trip, { forDriver = false, url } = {}) {
  const text = buildReceiptText(trip, { forDriver })
  const title = 'Clemson RIDES receipt'
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url })
      return 'shared'
    } catch (err) {
      if (err?.name === 'AbortError') return 'dismissed'
    }
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url ? `${text}\n${url}` : text)
    return 'copied'
  }
  if (typeof window !== 'undefined') {
    const href = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`
    window.location.href = href
    return 'mailto'
  }
  return 'unavailable'
}
