export function getHashRoute() {
  const hashRaw = (typeof window !== 'undefined' ? window.location.hash : '').replace(/^#\/?/, '')
  const pathRaw = (typeof window !== 'undefined' ? window.location.pathname : '').replace(/^\//, '')
  // Prefer hash when present; otherwise fall back to pathname (/share/:token survives chat clients that strip #…).
  const raw = hashRaw || pathRaw || 'landing'
  const [pathPart, qs] = raw.split('?')
  const segments = pathPart.split('/').filter(Boolean)
  const path = segments[0] || 'landing'
  const params = Object.fromEntries(new URLSearchParams(qs || ''))
  // Support #/share/<token>, /share/<token>, #/live/<token>, /live/<token>
  if ((path === 'share' || path === 'live') && segments[1] && !params.token) {
    params.token = decodeURIComponent(segments[1])
  }
  if (path === 'profile' && segments[1] && !params.id) params.id = segments[1]
  if (path === 'rate' && segments[1] && !params.trip) params.trip = segments[1]

  // Persist share token so a later hash clear (auth) can recover.
  if (typeof window !== 'undefined' && params.token && (path === 'share' || path === 'live')) {
    try {
      window.sessionStorage.setItem('clemson_live_share_token', params.token)
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
  return { path, params, segments }
}

export function navigate(path, params = {}) {
  // Allow path like 'share/tokenValue'
  if (path.includes('/') && Object.keys(params).length === 0) {
    const clean = path.replace(/^\//, '')
    // Prefer hash navigation inside the app shell
    window.location.hash = `#/${clean}`
    return
  }
  const qs = new URLSearchParams(params).toString()
  // Path-style for share/live so copied links survive # stripping
  if ((path === 'share' || path === 'live') && params.token) {
    const url = `${window.location.origin}/${path}/${encodeURIComponent(params.token)}`
    window.location.assign(url)
    return
  }
  window.location.hash = qs ? `#/${path}?${qs}` : `#/${path}`
}

/** Public share link — path form (not hash) so chat/email clients keep the token. */
export function shareUrl(token) {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://clemson-airport-rides.vercel.app'
  return `${origin}/share/${encodeURIComponent(token)}`
}
