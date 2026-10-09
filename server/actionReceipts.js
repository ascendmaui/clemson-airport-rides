/**
 * Idempotency receipts for driver trip actions (offline action queue).
 * A key is scoped to the driver who sent it. Only 2xx responses are kept,
 * so a rejected or failed attempt can be retried with the same key.
 * A missing table (migration not applied yet) never blocks the action.
 */
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9:_.-]{8,128}$/

export function idempotencyKeyFrom(req, body) {
  const header = req?.headers?.['idempotency-key'] ?? req?.headers?.['Idempotency-Key']
  const raw = (typeof body?.idempotencyKey === 'string' && body.idempotencyKey) || (typeof header === 'string' ? header : '')
  const key = String(raw || '').trim()
  if (!key) return { key: null }
  if (!IDEMPOTENCY_KEY_RE.test(key)) return { error: 'invalid_idempotency_key' }
  return { key }
}

function missingTable(error) {
  return /driver_action_receipts|relation|does not exist|schema cache/i.test(error?.message || '')
}

/** Stored response for this key, or null. A key from another driver is a conflict. */
export async function readReceipt(sb, key, driverId) {
  if (!sb || !key) return null
  const { data, error } = await sb.from('driver_action_receipts')
    .select('driver_id, trip_id, op, http_status, response').eq('idempotency_key', key).maybeSingle()
  if (error) {
    if (!missingTable(error)) console.error('[action-receipts] read', error.message)
    return null
  }
  if (!data) return null
  if (data.driver_id !== driverId) return { conflict: true }
  return { status: data.http_status, body: { ...(data.response || {}), idempotent: true, replayed: true } }
}

export async function writeReceipt(sb, { key, driverId, tripId, op, status, body }) {
  if (!sb || !key || !driverId || !tripId || status < 200 || status >= 300) return
  const { error } = await sb.from('driver_action_receipts').upsert({
    idempotency_key: key,
    driver_id: driverId,
    trip_id: tripId,
    op: String(op || ''),
    http_status: status,
    response: body && typeof body === 'object' ? body : {},
  }, { onConflict: 'idempotency_key', ignoreDuplicates: true })
  if (error && !missingTable(error)) console.error('[action-receipts] write', error.message)
}

/**
 * Runs a driver action handler with idempotency receipts. Without a key the
 * handler runs unchanged (older driver builds). With a key, a stored 2xx
 * response is replayed; otherwise the handler runs and its 2xx response is
 * stored before it is sent.
 */
export async function withActionReceipts(req, res, deps, inner, helpers) {
  const { admin, json, parseBody, userFromAuth } = helpers
  if (req.method !== 'POST') return inner(req, res, deps)
  const parsed = parseBody(req)
  if (parsed.error) return inner(req, res, deps)
  const k = idempotencyKeyFrom(req, parsed.body)
  if (!k.key && !k.error) return inner(req, res, deps)
  if (k.error) return json(res, 400, { ok: false, code: k.error, error: 'Invalid idempotency key' })
  const sb = deps.sb !== undefined ? deps.sb : admin()
  if (!sb) return inner(req, res, deps)
  const user = deps.user !== undefined ? deps.user : await userFromAuth(req)
  const next = { ...deps, sb, user }
  if (!user) return inner(req, res, next)
  const prior = await (deps.readReceipt || readReceipt)(sb, k.key, user.id)
  if (prior?.conflict) return json(res, 409, { ok: false, code: 'idempotency_conflict', error: 'Idempotency key already used' })
  if (prior) return json(res, prior.status, prior.body)

  const realEnd = res.end
  let held = null
  res.end = function holdEnd(...args) {
    if (!held) held = args
    return res
  }
  try {
    await inner(req, res, next)
  } finally {
    res.end = realEnd
  }
  if (!held) return
  const status = Number(res.statusCode) || 200
  if (status >= 200 && status < 300) {
    let body = null
    try { body = JSON.parse(String(held[0] ?? '')) } catch { body = null }
    if (body) {
      await (deps.writeReceipt || writeReceipt)(sb, {
        key: k.key, driverId: user.id, tripId: parsed.body.tripId, op: parsed.body.stopIndex !== undefined ? `stop:${parsed.body.stopIndex}:${parsed.body.op}` : String(parsed.body.op || ''), status, body,
      })
    }
  }
  return realEnd.apply(res, held)
}
