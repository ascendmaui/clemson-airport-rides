/** Tiny in-memory stand-in for the supabase-js calls the ads code makes. Test-only. */
import { randomUUID } from 'node:crypto'

const RELATIONS = {
  ad_campaigns: {
    ad_creatives: { table: 'ad_creatives', many: true, match: (row, o) => o.campaign_id === row.id },
    ad_packages: { table: 'ad_packages', match: (row, o) => o.id === row.package_id },
    ad_partners: { table: 'ad_partners', match: (row, o) => o.id === row.partner_id },
  },
  ad_creatives: {
    ad_campaigns: { table: 'ad_campaigns', match: (row, o) => o.id === row.campaign_id },
  },
  ad_campaign_boosts: {
    ad_campaigns: { table: 'ad_campaigns', match: (row, o) => o.id === row.campaign_id, nested: true },
  },
}
const DEFAULTS = {
  ad_campaigns: () => ({ rides_served: 0, status: 'draft', starts_at: null, ends_at: null, rides_purchased: null, paid_at: null }),
  ad_creatives: () => ({ approval_status: 'pending_review', theme: 'purple' }),
  ad_partners: () => ({ status: 'pending', profile_id: null, stripe_customer_id: null }),
  ad_devices: () => ({ active: true, demo: false }),
  ad_partner_applications: () => ({ status: 'pending', partner_id: null }),
  ad_campaign_boosts: () => ({ status: 'pending_payment' }),
  ad_qr_scans: () => ({ duplicate: false }),
}

export function fakeAdsDb(seed = {}) {
  const tables = {
    ad_partners: [], ad_packages: [], ad_campaigns: [], ad_creatives: [], ad_devices: [], ad_impressions: [], ad_ride_counts: [], trips: [], ad_partner_leads: [],
    ad_qr_tokens: [], ad_qr_scans: [], ad_campaign_boosts: [], ad_partner_applications: [],
    ...structuredClone(seed),
  }
  const calls = []

  function expand(table, row, select) {
    const out = { ...row }
    const rel = RELATIONS[table] || {}
    for (const name of Object.keys(rel)) {
      if (!String(select || '').includes(`${name}(`)) continue
      const r = rel[name]
      const hits = tables[r.table].filter((o) => r.match(row, o)).map((o) => (r.nested ? expand(r.table, o, select) : { ...o }))
      out[name] = r.many ? hits : hits[0] || null
    }
    return out
  }

  function builder(table) {
    const state = { op: 'select', filters: [], select: '*', payload: null, limit: null, opts: {} }
    const rows = () => tables[table].filter((r) => state.filters.every((f) => f(r)))
    const run = () => {
      calls.push({ table, op: state.op, payload: state.payload })
      if (state.op === 'insert') {
        const list = (Array.isArray(state.payload) ? state.payload : [state.payload]).map((p) => ({ id: randomUUID(), created_at: new Date().toISOString(), ...(DEFAULTS[table]?.() || {}), ...p }))
        tables[table].push(...list)
        return list.map((r) => expand(table, r, state.select))
      }
      if (state.op === 'upsert') {
        const list = Array.isArray(state.payload) ? state.payload : [state.payload]
        const keys = String(state.opts.onConflict || 'id').split(',')
        const out = []
        for (const p of list) {
          const hit = tables[table].find((r) => keys.every((k) => r[k] != null && r[k] === p[k]))
          if (hit) { if (!state.opts.ignoreDuplicates) Object.assign(hit, p); continue }
          const row = { id: p.id || randomUUID(), ...p }
          tables[table].push(row)
          out.push(row)
        }
        return out
      }
      if (state.op === 'update') {
        const hit = rows()
        for (const r of hit) Object.assign(r, state.payload)
        return hit.map((r) => expand(table, r, state.select))
      }
      let list = rows().map((r) => expand(table, r, state.select))
      if (state.limit != null) list = list.slice(0, state.limit)
      return list
    }
    const api = {
      select(sel = '*') { state.select = sel; return api },
      insert(p) { state.op = 'insert'; state.payload = p; return api },
      update(p) { state.op = 'update'; state.payload = p; return api },
      upsert(p, opts = {}) { state.op = 'upsert'; state.payload = p; state.opts = opts; return api },
      eq(k, v) { state.filters.push((r) => r[k] === v); return api },
      in(k, vs) { state.filters.push((r) => vs.includes(r[k])); return api },
      is(k, v) { state.filters.push((r) => (r[k] ?? null) === v); return api },
      gte(k, v) { state.filters.push((r) => r[k] != null && String(r[k]) >= String(v)); return api },
      order() { return api },
      limit(n) { state.limit = n; return api },
      async single() { const d = run(); return d.length === 1 ? { data: d[0], error: null } : { data: null, error: { message: `expected 1 row, got ${d.length}` } } },
      async maybeSingle() { const d = run(); return { data: d[0] || null, error: null } },
      then(resolve, reject) { try { resolve({ data: run(), error: null }) } catch (e) { reject(e) } },
    }
    return api
  }

  return {
    tables,
    calls,
    from: (t) => builder(t),
    async rpc(name, args) {
      calls.push({ rpc: name, args })
      if (name !== 'ad_count_ride') return { data: null, error: { message: 'unknown rpc' } }
      const c = tables.ad_campaigns.find((x) => x.id === args.p_campaign)
      const dup = tables.ad_ride_counts.some((x) => x.campaign_id === args.p_campaign && x.trip_id === args.p_trip)
      if (!dup) {
        tables.ad_ride_counts.push({ campaign_id: args.p_campaign, trip_id: args.p_trip, device_id: args.p_device })
        c.rides_served += 1
        if (c.rides_purchased != null && c.rides_served >= c.rides_purchased && c.status === 'active') { c.status = 'ended'; c.ended_reason = 'rides_reached' }
      }
      return { data: [{ counted: !dup, rides_served: c.rides_served, status: c.status }], error: null }
    },
    storage: {
      from: () => ({
        getPublicUrl: (p) => ({ data: { publicUrl: `https://cdn.test/ad-creatives/${p}` } }),
        createSignedUploadUrl: async (p) => ({ data: { token: 'tok', signedUrl: `https://cdn.test/upload/${p}?token=tok`, path: p }, error: null }),
      }),
    },
  }
}
