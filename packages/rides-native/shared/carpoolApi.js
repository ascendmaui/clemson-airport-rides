/**
 * Same /api/carpool and /api/friend-rides routes as the web hub.
 * The host is a constant here so this file can live outside the Expo app.
 * The rider app may override it with setCarpoolApiBase.
 */

import { DEFAULT_API_BASE as DEFAULT_API } from '../apiOrigin.js'
import { authedJson as clientAuthedJson } from '../apiClient.js'
import { friendlyApiError } from '../apiErrors.js'

let baseOverride = ''

export function setCarpoolApiBase(base) {
  baseOverride = String(base || '').replace(/\/+$/, '')
}

export function apiBase() {
  return baseOverride || DEFAULT_API
}

function authedJson(supabase, path, options) {
  const url = path.startsWith('http') ? path : `${apiBase()}${path}`
  return clientAuthedJson(supabase, url, options)
}

export function inviteUrl(token, kind = 'carpool') {
  const path = kind === 'friends' ? 'friends' : 'carpool'
  return `${apiBase()}/${path}/${encodeURIComponent(token)}`
}

export function apiErrorMessage(err) {
  const friendly = friendlyApiError(err)
  if (friendly?.kind === 'unavailable' || friendly?.kind === 'auth') {
    return friendly.message
  }
  const payload = err?.payload
  if (payload && typeof payload.message === 'string' && payload.message) return payload.message
  if (payload && typeof payload.error === 'string' && payload.error) return payload.error
  if (err instanceof Error && err.message) return err.message
  return 'Something went wrong'
}

export function matchCarpool(supabase, body) {
  return authedJson(supabase, '/api/carpool?action=match', {
    method: 'POST',
    body: {
      pickup: body.pickup,
      dropoff: body.dropoff,
      displayName: body.displayName,
      partyType: body.partyType === 'tailgate' ? 'tailgate' : 'carpool',
      departAt: body.departAt || undefined,
      ambassadorCode: body.ambassadorCode || undefined,
    },
  })
}

export function createCarpoolGroup(supabase, body) {
  return authedJson(supabase, '/api/carpool?action=group', {
    method: 'POST',
    body: {
      pickup: body.pickup,
      dropoff: body.dropoff,
      displayName: body.displayName,
      partyType: body.partyType === 'tailgate' ? 'tailgate' : 'carpool',
      driving: false,
      ambassadorCode: body.ambassadorCode || undefined,
    },
  })
}

export function claimAmbassadorAttribution(supabase, code) {
  return authedJson(supabase, '/api/carpool?action=attribute', {
    method: 'POST',
    body: { code },
  })
}

export function carpoolProgram(supabase, action) {
  return authedJson(supabase, '/api/carpool?action=program', {
    method: 'POST',
    body: { action, origin: apiBase() },
  })
}

export function createCarpoolOffer(supabase, body) {
  return authedJson(supabase, '/api/friend-rides?action=create', {
    method: 'POST',
    body: {
      displayName: body.displayName,
      pickup: body.pickup,
      dropoff: body.dropoff,
      splitMode: body.splitMode === 'by_distance' ? 'by_distance' : 'even',
      kind: 'carpool',
      partyType: body.partyType === 'tailgate' ? 'tailgate' : 'carpool',
      ambassadorCode: body.ambassadorCode || undefined,
    },
  })
}

export function getFriendRide(supabase, token) {
  return authedJson(supabase, `/api/friend-rides?action=get&token=${encodeURIComponent(token)}`)
}

export function joinFriendRide(supabase, body) {
  return authedJson(supabase, '/api/friend-rides?action=join', {
    method: 'POST',
    body: {
      ...body,
      ambassadorCode: body.ambassadorCode || undefined,
    },
  })
}

export function recomputeFriendRide(supabase, token, splitMode) {
  return authedJson(supabase, '/api/friend-rides?action=recompute', {
    method: 'POST',
    body: { token, splitMode: splitMode === 'by_distance' ? 'by_distance' : 'even' },
  })
}

export function confirmFriendCharges(supabase, token, quote) {
  const body = { token, useCredits: true, origin: apiBase() }
  if (quote?.quoteId) body.quoteId = String(quote.quoteId)
  if (quote?.quoteSignature) body.quoteSignature = String(quote.quoteSignature)
  return authedJson(supabase, '/api/friend-rides?action=confirm-charges', {
    method: 'POST',
    body,
  })
}
