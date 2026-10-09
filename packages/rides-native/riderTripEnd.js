/**
 * Rider end-screen choices. Stars start at five. The tip amount is chosen
 * here and priced on the server. This module does not charge a card.
 */

export const AUTO_RIDER_STARS = 5

export function defaultTipChoiceId(offer) {
  if (!offer || typeof offer !== 'object') return null
  if (offer.choice) return null
  if (Number(offer.chargedTipCents) > 0) return null
  if (typeof offer.popularId === 'string' && offer.popularId) return offer.popularId
  const presets = Array.isArray(offer.presets) ? offer.presets : []
  const popular = presets.find((row) => row && row.popular && row.id)
  return popular?.id || null
}

export function tipRecordBody(tripId, choiceId, customDollars) {
  const id = String(tripId || '').trim()
  const choice = String(choiceId || '').trim()
  if (!id) return { ok: false, error: 'Missing trip' }
  if (!choice) return { ok: false, error: 'Pick a tip' }
  if (choice === 'custom') {
    const dollars = typeof customDollars === 'number' && Number.isFinite(customDollars)
      ? String(customDollars)
      : String(customDollars ?? '').trim()
    if (!dollars) return { ok: false, error: 'Enter a tip amount' }
    return { ok: true, body: { mode: 'record', tripId: id, choiceId: 'custom', customDollars: dollars } }
  }
  return { ok: true, body: { mode: 'record', tripId: id, choiceId: choice } }
}

export function endScreenCanComplete({ stars, choiceId, customDollars, needsTip }) {
  const value = Number(stars)
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    return { ok: false, error: 'Stars must be 1–5' }
  }
  if (!needsTip) return { ok: true, error: null }
  const tip = tipRecordBody('trip', choiceId, customDollars)
  if (!tip.ok) return { ok: false, error: tip.error }
  return { ok: true, error: null }
}
