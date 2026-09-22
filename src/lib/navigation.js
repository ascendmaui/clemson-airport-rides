export function getHashRoute() {
  const raw = window.location.hash.replace(/^#\/?/, '') || 'landing'
  const [pathPart, qs] = raw.split('?')
  const segments = pathPart.split('/').filter(Boolean)
  const path = segments[0] || 'landing'
  const params = Object.fromEntries(new URLSearchParams(qs || ''))
  // Support #/share/<token> and #/profile/<id>
  if (path === 'share' && segments[1] && !params.token) params.token = segments[1]
  if (path === 'live' && segments[1] && !params.token) params.token = segments[1]
  if (path === 'profile' && segments[1] && !params.id) params.id = segments[1]
  if (path === 'rate' && segments[1] && !params.trip) params.trip = segments[1]
  return { path, params, segments }
}

export function navigate(path, params = {}) {
  // Allow path like 'share/tokenValue'
  if (path.includes('/') && Object.keys(params).length === 0) {
    window.location.hash = `#/${path}`
    return
  }
  const qs = new URLSearchParams(params).toString()
  window.location.hash = qs ? `#/${path}?${qs}` : `#/${path}`
}

export function shareUrl(token) {
  const base = `${window.location.origin}${window.location.pathname}`
  return `${base}#/share/${encodeURIComponent(token)}`
}
