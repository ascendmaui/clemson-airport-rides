/**
 * Idempotency receipts for driver trip actions (offline action queue).
 *
 * A key is claimed before the action runs (http_status 0 = in flight), so two
 * concurrent retries never both run it: the second gets 409
 * idempotency_in_progress and the app retries later. A 2xx response is stored
 * on the claim and replayed for the same driver, trip and op; any other use of
 * the key is 409 idempotency_conflict. A non-2xx result releases the claim so
 * the same key can be retried. Without the table (migration not applied yet)
 * actions run exactly as before.
 */
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9:_.-]{8,128}$/
export const CLAIM_STALE_MS = 60 * 1000

export function idempotencyKeyFrom(req, body) {
  const header = req?.headers?.['idempotency-key'] ?? req?.headers?.['Idempotency-Key']
  const raw = (typeof body?.idempotencyKey === 'string' && body.idempotencyKey) || (typeof header === 'string' ? header : '')
  const key = String(raw || '').trim()
  if (!key) return { key: null }
  if (!IDEMPOTENCY_KEY_RE.test(key)) return { error: 'invalid_idempotency_key' }
  return { key }
}

/** Normalized op for a request body: 'arrive' or 'stop:2:drop'. */
export function receiptOp(body) {
  if (body?.stopIndex !== undefined && body?.stopIndex !== null) return `stop:${body.stopIndex}:${body.op}`
  return String(body?.op || '')
}

function missingTable(error) {
  return ['42P01', 'PGRST205'].includes(error?.code) || /driver_action_receipts|does not exist|schema cache/i.test(error?.message || '')
}
function duplicate(error) {
  return error?.code === '23505' || /duplicate key|unique/i.test(error?.message || '')
}

/**
 * Claim a key. Resolves to one of
 * { claimed } | { replay: { status, body } } | { conflict } | { inProgress } | { unavailable }.
 */
export async function claimReceipt(sb, { key, driverId, tripId, op }, { now = Date.now() } = {}) {
  const row = { idempotency_key: key, driver_id: driverId, trip_id: tripId, op, http_status: 0, response: {} }
  const inserted = await sb.from('driver_action_receipts').insert(row)
  if (!inserted?.error) return { claimed: true }
  if (!duplicate(inserted.error)) {
    if (!missingTable(inserted.error)) console.error('[action-receipts] claim', inserted.error.message)
    return { unavailable: true }
  }
  const read = await sb.from('driver_action_receipts')
    .select('driver_id, trip_id, op, http_status, response, created_at').eq('idempotency_key', key).maybeSingle()
  if (read?.error || !read?.data) return { inProgress: true }
  const prior = read.data
  if (prior.driver_id !== driverId || prior.trip_id !== tripId || prior.op !== op) return { conflict: true }
  const status = Number(prior.http_status) || 0
  if (status >= 200 && status < 300) {
    return { replay: { status, body: { ...(prior.response || {}), idempotent: true, replayed: true } } }
  }
  // An in-flight claim left by a crashed attempt can be taken over once stale.
  const age = now - Date.parse(prior.created_at || 0)
  if (status === 0 && Number.isFinite(age) && age > CLAIM_STALE_MS) {
    const taken = await sb.from('driver_action_receipts')
      .update({ created_at: new Date(now).toISOString() })
      .eq('idempotency_key', key).eq('http_status', 0).eq('created_at', prior.created_at)
      .select('idempotency_key')
    if (!taken?.error && taken?.data?.length) return { claimed: true }
  }
  return { inProgress: true }
}

/** Store a 2xx response on the claim, or release the claim for anything else. */
export async function finishReceipt(sb, { key, status, body }) {
  try {
    const result = status >= 200 && status < 300
      ? await sb.from('driver_action_receipts')
        .update({ http_status: status, response: body && typeof body === 'object' ? body : {} })
        .eq('idempotency_key', key).eq('http_status', 0)
      : await sb.from('driver_action_receipts').delete().eq('idempotency_key', key).eq('http_status', 0)
    if (result?.error) console.error('[action-receipts] finish', result.error.message)
  } catch (err) {
    console.error('[action-receipts] finish', err?.message || err)
  }
}

/**
 * Runs a driver action handler with idempotency receipts. Without a key the
 * handler runs unchanged (older driver builds).
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
  const tripId = parsed.body.tripId
  if (!user || typeof tripId !== 'string' || !tripId) return inner(req, res, next)

  const claim = await (deps.claimReceipt || claimReceipt)(sb, { key: k.key, driverId: user.id, tripId, op: receiptOp(parsed.body) })
  if (claim.conflict) return json(res, 409, { ok: false, code: 'idempotency_conflict', error: 'Idempotency key already used for another action' })
  if (claim.inProgress) return json(res, 409, { ok: false, code: 'idempotency_in_progress', error: 'This action is still being applied. Retrying.' })
  if (claim.replay) return json(res, claim.replay.status, claim.replay.body)
  if (!claim.claimed) return inner(req, res, next)

  const realEnd = res.end
  let held = null
  res.end = function holdEnd(...args) {
    if (!held) held = args
    return res
  }
  try {
    await inner(req, res, next)
  } catch (err) {
    res.end = realEnd
    await (deps.finishReceipt || finishReceipt)(sb, { key: k.key, status: 500, body: null })
    throw err
  }
  res.end = realEnd
  const status = Number(res.statusCode) || 200
  let body = null
  try { body = JSON.parse(String(held?.[0] ?? '')) } catch { body = null }
  await (deps.finishReceipt || finishReceipt)(sb, { key: k.key, status: body ? status : 500, body })
  if (!held) return
  return realEnd.apply(res, held)
}
