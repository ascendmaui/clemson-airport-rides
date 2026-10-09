import { isDeepStrictEqual } from 'node:util'

// Executes conditional writes at await time, including the claim-slot JSON path filters used
// by the production claim. Hooks allow races at the actual write boundary.
export function tripCompletionDb(trip = null, options = {}) {
  const tables = { trips: trip ? [structuredClone(trip)] : [], profiles: options.profiles || [], payments: [], trip_events: [], driver_payouts: [] }
  const updates = []
  const sb = {
    tables, updates,
    seedTrip(row) { if (!tables.trips.length) tables.trips.push(structuredClone(row)) },
    from(table) {
      tables[table] ||= []
      let op = 'read', patch
      const filters = []
      function run(single = false) {
        if (op === 'update') {
          options.beforeUpdate?.({ table, patch, filters, tables })
          updates.push({ table, patch, filters, col: filters[0]?.[0], val: filters[0]?.[1] })
          if (options.updateError) return { error: options.updateError, data: null }
        }
        const rows = tables[table].filter(row => filters.every(([key, val]) => {
          if (key === 'metadata') return isDeepStrictEqual(row.metadata ?? null, val === null ? null : JSON.parse(val))
          if (key === 'metadata->completion_claim->>token') return row.metadata?.completion_claim?.token === val
          if (key === 'metadata->completion_claim') return (row.metadata?.completion_claim ?? null) === val
          return row[key] === val || (row[key] == null && val === null)
        }))
        if (op === 'update') rows.forEach(row => Object.assign(row, structuredClone(patch)))
        if (op === 'insert' || op === 'upsert') {
          if (table === 'trip_events' && options.eventError) return { error: options.eventError, data: null }
          const row = { id: `${table}_${tables[table].length + 1}`, ...patch }
          const existing = op === 'upsert' && tables[table].find(r => r.trip_id === row.trip_id)
          if (existing) Object.assign(existing, row)
          else tables[table].push(row)
          return { data: single ? row : [row], error: null }
        }
        return { data: single ? (rows[0] ? structuredClone(rows[0]) : null) : structuredClone(rows), error: null }
      }
      const query = {
        select() { return query },
        eq(key, val) { filters.push([key, val]); return query },
        is(key, val) { filters.push([key, val]); return query },
        update(value) { op = 'update'; patch = value; return query },
        insert(value) { op = 'insert'; patch = value; return query },
        upsert(value) { op = 'upsert'; patch = value; return query },
        maybeSingle: async () => run(true),
        single: async () => run(true),
        then(resolve, reject) { return Promise.resolve(run()).then(resolve, reject) },
      }
      return query
    },
  }
  return sb
}
