/**
 * In-memory Supabase stand-in for end-to-end tests that cross the web
 * client, the API handlers, and the driver desk. Supports the query shapes
 * those paths use: eq/neq/in/is/or filters (including metadata->>key and the
 * stringified-metadata compare), insert/update/upsert with select, single,
 * maybeSingle, thenable reads, and rpc.
 */
import { isDeepStrictEqual } from 'node:util'

function readPath(row, key) {
  const arrow = key.indexOf('->>')
  if (arrow < 0) {
    if (key.includes('->')) {
      const parts = key.split('->')
      return parts.reduce((acc, part) => (acc == null ? undefined : acc[part]), row)
    }
    return row[key]
  }
  const head = key.slice(0, arrow)
  const tail = key.slice(arrow + 3)
  const base = head.split('->').reduce((acc, part) => (acc == null ? undefined : acc[part]), row)
  const value = base == null ? undefined : base[tail]
  return value == null ? value : String(value)
}

function matchEq(row, key, val) {
  if (key === 'metadata' && typeof val === 'string') {
    return isDeepStrictEqual(row.metadata ?? null, JSON.parse(val))
  }
  const got = readPath(row, key)
  return got === val || (got == null && val == null)
}

function orMatcher(expr) {
  const parts = String(expr).split(',')
  const tests = parts.map((part) => {
    const m = part.match(/^(.+?)\.(is|eq|neq)\.(.*)$/)
    if (!m) throw new Error(`memorySupabase: unsupported or() clause ${part}`)
    const [, col, op, raw] = m
    let val = raw
    if (op === 'is' && raw === 'null') val = null
    else if (raw.startsWith('"') && raw.endsWith('"')) val = JSON.parse(raw)
    return (row) => {
      const got = readPath(row, col)
      if (op === 'is') return got == null
      if (op === 'eq') return got === val
      return got !== val
    }
  })
  return (row) => tests.some((fn) => fn(row))
}

export function memorySupabase(seed = {}, { rpc = {}, session = null } = {}) {
  const tables = {}
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((row) => structuredClone(row))
  const writes = []
  let nextId = 1
  const rowsOf = (table) => (tables[table] ||= [])

  function from(table) {
    let op = 'select'
    let payload = null
    let wantsRows = false
    let upsertKey = null
    const filters = []
    const run = (single) => {
      const all = rowsOf(table)
      const pick = () => all.filter((row) => filters.every((fn) => fn(row)))
      let data
      if (op === 'insert' || op === 'upsert') {
        const list = (Array.isArray(payload) ? payload : [payload]).map((value) => ({ ...value }))
        data = list.map((value) => {
          if (op === 'upsert') {
            const keys = upsertKey ? upsertKey.split(',') : ['id', 'driver_id', 'trip_id', 'rider_id', 'profile_id'].filter((k) => value[k] != null).slice(0, 1)
            const existing = keys.length ? all.find((row) => keys.every((k) => row[k] === value[k])) : null
            if (existing) { Object.assign(existing, value); return existing }
          }
          const row = { id: value.id || `${table}-${nextId++}`, created_at: new Date().toISOString(), ...value }
          all.push(row)
          return row
        })
        writes.push({ table, op, payload })
      } else if (op === 'update') {
        data = pick()
        data.forEach((row) => Object.assign(row, structuredClone(payload)))
        writes.push({ table, op, payload, matched: data.length })
      } else if (op === 'delete') {
        data = pick()
        tables[table] = all.filter((row) => !data.includes(row))
        writes.push({ table, op, matched: data.length })
      } else {
        data = pick()
      }
      const out = structuredClone(data)
      if (single) return { data: out[0] ?? null, error: single === 'single' && !out[0] ? { message: 'no rows' } : null }
      if ((op === 'insert' || op === 'update' || op === 'upsert') && !wantsRows) return { data: null, error: null }
      return { data: out, error: null }
    }
    const q = {
      select() { wantsRows = true; return q },
      eq(key, val) { filters.push((row) => matchEq(row, key, val)); return q },
      neq(key, val) { filters.push((row) => !matchEq(row, key, val)); return q },
      in(key, vals) { filters.push((row) => vals.includes(readPath(row, key))); return q },
      is(key, val) { filters.push((row) => (val === null ? readPath(row, key) == null : readPath(row, key) === val)); return q },
      or(expr) { filters.push(orMatcher(expr)); return q },
      not() { return q },
      gt() { return q },
      gte() { return q },
      lt() { return q },
      lte() { return q },
      order() { return q },
      limit() { return q },
      range() { return q },
      insert(value) { op = 'insert'; payload = value; return q },
      update(value) { op = 'update'; payload = value; return q },
      upsert(value, options = {}) { op = 'upsert'; payload = value; upsertKey = options.onConflict || null; return q },
      delete() { op = 'delete'; return q },
      maybeSingle: async () => run('maybe'),
      single: async () => run('single'),
      then(resolve, reject) { return Promise.resolve(run(false)).then(resolve, reject) },
    }
    return q
  }

  return {
    tables,
    writes,
    from,
    async rpc(name, args) {
      const fn = rpc[name]
      if (!fn) return { data: null, error: { code: 'PGRST202', message: `rpc ${name} missing` } }
      return { data: await fn(args, tables), error: null }
    },
    auth: {
      async getSession() { return { data: { session } } },
      async refreshSession() { return { data: { session }, error: null } },
    },
    removeChannel() {},
  }
}
