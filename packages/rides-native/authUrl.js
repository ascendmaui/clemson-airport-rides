/** Pull Supabase recovery tokens out of a rider deep link. */

export function parseSupabaseAuthUrl(url) {
  if (!url || typeof url !== 'string') return null
  const hashIndex = url.indexOf('#')
  const queryIndex = url.indexOf('?')
  const query = queryIndex >= 0
    ? url.slice(queryIndex + 1, hashIndex >= 0 ? hashIndex : undefined)
    : ''
  const hash = hashIndex >= 0 ? url.slice(hashIndex + 1) : ''
  const hashParams = new URLSearchParams(hash)
  const queryParams = new URLSearchParams(query)
  const pick = (key) => hashParams.get(key) || queryParams.get(key)
  const accessToken = pick('access_token')
  const refreshToken = pick('refresh_token')
  const code = pick('code')
  const type = pick('type')
  if (accessToken && refreshToken) {
    return { kind: 'session', accessToken, refreshToken, type }
  }
  if (code) return { kind: 'code', code, type }
  return null
}
