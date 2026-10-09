/** Private own-row storage takes precedence over optional legacy presence tokens. */
const emptyToken = () => ({ token: null, platform: null, source: null })
const clean = (value) => String(value || '').trim()

async function readRows(sb, table, columns, ids) {
  try {
    let query = sb.from(table).select(columns)
    query = ids ? query.in('driver_id', ids) : query.limit(500)
    const result = await query
    return result?.error || !Array.isArray(result?.data) ? [] : result.data
  } catch { return [] }
}

/** Returns a Map keyed by driver id. Omitted ids reads up to 500 for broadcasts. */
export async function readDriverPushTokens(sb, ids) {
  const wanted = ids == null ? null : [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean))]
  const tokens = new Map((wanted || []).map((id) => [id, emptyToken()]))
  if (wanted && !wanted.length) return tokens
  const rows = await readRows(sb, 'driver_push_tokens', 'driver_id, token, platform', wanted)
  for (const row of rows) {
    const token = clean(row.token)
    if (row.driver_id && token) tokens.set(row.driver_id, { token, platform: clean(row.platform) || null, source: 'driver_push_tokens' })
  }
  const missing = wanted ? wanted.filter((id) => !tokens.get(id)?.token) : null
  if (missing && !missing.length) return tokens
  const legacy = await readRows(sb, 'driver_status', 'driver_id, expo_push_token', missing)
  for (const row of legacy) {
    const token = clean(row.expo_push_token)
    if (row.driver_id && token && !tokens.get(row.driver_id)?.token) tokens.set(row.driver_id, { token, platform: null, source: 'driver_status' })
  }
  return tokens
}

export async function readDriverPushToken(sb, driverId) {
  if (!driverId) return emptyToken()
  // Keep single-row reads compatible with callers and older Supabase clients.
  for (const [table, columns, column] of [
    ['driver_push_tokens', 'token, platform', 'token'],
    ['driver_status', 'expo_push_token', 'expo_push_token'],
  ]) {
    try {
      const result = await sb.from(table).select(columns).eq('driver_id', driverId).maybeSingle()
      const token = !result?.error && clean(result?.data?.[column])
      if (token) return { token, platform: clean(result.data.platform) || null, source: table }
    } catch { /* Missing legacy columns and unavailable storage must not break alerts. */ }
  }
  return emptyToken()
}
