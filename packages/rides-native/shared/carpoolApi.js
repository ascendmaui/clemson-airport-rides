/**
 * Same /api/carpool and /api/friend-rides routes as the web hub.
 * The host is a constant here so this file can live outside the Expo app.
 * The rider app may override it with setCarpoolApiBase.
 */

const DEFAULT_API = 'https://clemson-airport-rides.vercel.app'
let baseOverride = ''

export function setCarpoolApiBase(base) {
  baseOverride = String(base || '').replace(/\/$/, '')
}

export function apiBase() {
  return baseOverride || DEFAULT_API
}

async function authedJson(supabase, path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (supabase) {
    const { data } = await supabase.auth.getSession()
    const token = data?.session?.access_token
    if (token) headers.Authorization = `Bearer ${token}`
  }
  const url = path.startsWith('http') ? path : `${apiBase()}${path}`
  let res
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
    })
  } catch (err) {
    throw new Error(err?.message || 'Network error')
  }
  const text = await res.text()
  let data = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    const error = new Error('API unavailable')
    error.status = res.status
    throw error
  }
  if (!res.ok) {
    const error = new Error(data.error || data.message || `HTTP ${res.status}`)
    error.status = res.status
    error.payload = data
    throw error
  }
  return data
}

export function inviteUrl(token, kind = 'carpool') {
  const path = kind === 'friends' ? 'friends' : 'carpool'
  return `${apiBase()}/${path}/${encodeURIComponent(token)}`
}

export function apiErrorMessage(err) {
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
    },
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
    },
  })
}

export function getFriendRide(supabase, token) {
  return authedJson(supabase, `/api/friend-rides?action=get&token=${encodeURIComponent(token)}`)
}

export function joinFriendRide(supabase, body) {
  return authedJson(supabase, '/api/friend-rides?action=join', {
    method: 'POST',
    body,
  })
}

export function recomputeFriendRide(supabase, token, splitMode) {
  return authedJson(supabase, '/api/friend-rides?action=recompute', {
    method: 'POST',
    body: { token, splitMode: splitMode === 'by_distance' ? 'by_distance' : 'even' },
  })
}

export function confirmFriendCharges(supabase, token) {
  return authedJson(supabase, '/api/friend-rides?action=confirm-charges', {
    method: 'POST',
    body: { token, useCredits: true, origin: apiBase() },
  })
}
