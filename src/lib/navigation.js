export function getHashRoute() {
  const raw = window.location.hash.replace(/^#\/?/, '') || 'landing'
  const [path, qs] = raw.split('?')
  const params = Object.fromEntries(new URLSearchParams(qs || ''))
  return { path, params }
}

export function navigate(path, params = {}) {
  const qs = new URLSearchParams(params).toString()
  window.location.hash = qs ? `#/${path}?${qs}` : `#/${path}`
}
