/**
 * If the URL is still on the legacy hash form (#/share|:live|:friends|:carpool/:token),
 * immediately replace with the path form. Path form is what production serves
 * reliably for Google CampusMap / public invite links.
 */
import { WEB_ORIGIN } from '../../shared/productLinks.js'

export function redirectShareHashToPath() {
  if (typeof window === 'undefined') return false
  const hash = window.location.hash || ''
  const m = hash.match(/^#\/(share|live|friends|carpool)\/([^/?#]+)\/?(?:[?#].*)?$/)
  if (!m) return false
  const kind = m[1]
  const token = decodeURIComponent(m[2])
  const search = window.location.search || ''
  const target = `${window.location.origin}/${kind}/${encodeURIComponent(token)}${search}`
  window.location.replace(target)
  return true
}

// Run as early as this module is evaluated (before React paint when imported from main).
redirectShareHashToPath()

export function getHashRoute() {
  // Re-check on every route read in case hash was set after first import.
  if (redirectShareHashToPath()) {
    return { path: 'landing', params: {}, segments: [] }
  }

  const hashRaw = (typeof window !== 'undefined' ? window.location.hash : '').replace(/^#\/?/, '')
  const pathRaw = (typeof window !== 'undefined' ? window.location.pathname : '').replace(/^\//, '')
  // Prefer hash when present; otherwise fall back to pathname.
  const raw = hashRaw || pathRaw || 'landing'
  const [pathPart, qs] = raw.split('?')
  const segments = pathPart.split('/').filter(Boolean)
  const path = segments[0] || 'landing'
  const params = Object.fromEntries(new URLSearchParams(qs || ''))
  // Support #/share|live|friends|carpool/<token> and path equivalents
  if ((path === 'share' || path === 'live' || path === 'friends' || path === 'carpool') && segments[1] && !params.token) {
    params.token = decodeURIComponent(segments[1])
  }
  if (path === 'profile' && segments[1] && !params.id) params.id = segments[1]
  if (path === 'rate' && segments[1] && !params.trip) params.trip = segments[1]
  if (path === 'account' && segments[1] && !params.tab) {
    params.tab = decodeURIComponent(segments[1])
  }
  if (path === 'receipt' && segments[1] && !params.trip) params.trip = segments[1]

  // Persist share/friends token so a later hash clear (auth) can recover.
  if (typeof window !== 'undefined' && params.token && (path === 'share' || path === 'live')) {
    try {
      window.sessionStorage.setItem('clemson_live_share_token', params.token)
    } catch {
      /* ignore */
    }
  }
  if (typeof window !== 'undefined' && params.token && path === 'friends') {
    try {
      window.sessionStorage.setItem('clemson_friends_token', params.token)
    } catch {
      /* ignore */
    }
  }
  if (typeof window !== 'undefined' && params.token && path === 'carpool') {
    try {
      window.sessionStorage.setItem('clemson_carpool_token', params.token)
    } catch {
      /* ignore */
    }
  }
  if ((path === 'share' || path === 'live') && !params.token && typeof window !== 'undefined') {
    try {
      const saved = window.sessionStorage.getItem('clemson_live_share_token')
      if (saved) params.token = saved
    } catch {
      /* ignore */
    }
  }
  if (path === 'friends' && !params.token && typeof window !== 'undefined') {
    try {
      const saved = window.sessionStorage.getItem('clemson_friends_token')
      if (saved) params.token = saved
    } catch {
      /* ignore */
    }
  }
  if ((path === 'a' || path === 'ambassador') && segments[1] && !params.code) {
    params.code = decodeURIComponent(segments[1])
  }
  if (path === 'carpool' && !params.token && !params.hub && !params.drive && typeof window !== 'undefined') {
    try {
      const saved = window.sessionStorage.getItem('clemson_carpool_token')
      if (saved) params.token = saved
    } catch {
      /* ignore */
    }
  }
  return { path, params, segments }
}

export function navigate(path, params = {}) {
  // Allow path like 'share/tokenValue' or 'friends/tokenValue' or 'carpool/tokenValue'
  if (path.includes('/') && Object.keys(params).length === 0) {
    const clean = path.replace(/^\//, '')
    const [head, ...rest] = clean.split('/')
    if ((head === 'share' || head === 'live' || head === 'friends' || head === 'carpool') && rest[0]) {
      const url = `${window.location.origin}/${head}/${encodeURIComponent(rest[0])}`
      window.location.assign(url)
      return
    }
    window.location.hash = `#/${clean}`
    return
  }
  const qs = new URLSearchParams(params).toString()
  if ((path === 'share' || path === 'live' || path === 'friends' || path === 'carpool') && params.token) {
    const url = `${window.location.origin}/${path}/${encodeURIComponent(params.token)}`
    window.location.assign(url)
    return
  }
  // bare 'friends' / 'carpool' create screen uses hash
  if (path === 'friends' && !params.token) {
    window.location.hash = '#/friends'
    return
  }
  if (path === 'carpool' && !params.token) {
    const qs = new URLSearchParams(params).toString()
    window.location.hash = qs ? `#/carpool?${qs}` : '#/carpool?hub=1'
    return
  }
  window.location.hash = qs ? `#/${path}?${qs}` : `#/${path}`
}

/** Public share link — path form (not hash) so chat/email clients keep the token. */
export function shareUrl(token) {
  const origin = typeof window !== 'undefined' ? window.location.origin : WEB_ORIGIN
  return `${origin}/share/${encodeURIComponent(token)}`
}

export function friendsInviteUrl(token) {
  const origin = typeof window !== 'undefined' ? window.location.origin : WEB_ORIGIN
  return `${origin}/friends/${encodeURIComponent(token)}`
}

export function carpoolInviteUrl(token) {
  const origin = typeof window !== 'undefined' ? window.location.origin : WEB_ORIGIN
  return `${origin}/carpool/${encodeURIComponent(token)}`
}
