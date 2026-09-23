/**
 * GET /api/driver-earnings
 * Aggregates payments + ride_bills for the signed-in driver's completed trips.
 * Drivers cannot select those tables under RLS (payments: rider only, bills: participant).
 * Service role is used only after the JWT is verified, and only for that driver's trip ids.
 * Response has amounts and routed distance/duration — no addresses, names, emails, or Stripe ids.
 */
import { createClient } from '@supabase/supabase-js'

const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://awktabuhijrshmsmagpq.supabase.co'
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.end(JSON.stringify(body))
}

function admin() {
  if (!serviceKey) return null
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function userFromAuth(req, sb) {
  const header = req.headers.authorization || req.headers.Authorization || ''
  const match = String(header).match(/^Bearer\s+(.+)$/i)
  if (!match) return null
  const { data, error } = await sb.auth.getUser(match[1])
  if (error || !data?.user) return null
  return data.user
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 204, {})
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' })

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  const user = await userFromAuth(req, sb)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  const { data: trips, error: tripErr } = await sb
    .from('trips')
    .select('id')
    .eq('driver_id', user.id)
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })
    .limit(1000)

  if (tripErr) return json(res, 500, { error: tripErr.message || 'Could not load trips' })

  const ids = (trips || []).map((trip) => trip.id).filter(Boolean)
  if (!ids.length) return json(res, 200, { paymentsByTrip: {}, billsByTrip: {} })

  const [{ data: payments, error: payErr }, { data: bills, error: billErr }] = await Promise.all([
    sb.from('payments').select('trip_id, kind, amount_cents, status').in('trip_id', ids),
    sb.from('ride_bills').select('trip_id, base_cents, distance_cents, time_cents, surge_cents, distance_m, duration_s').in('trip_id', ids),
  ])

  if (payErr) return json(res, 500, { error: payErr.message || 'Could not load payments' })
  if (billErr) return json(res, 500, { error: billErr.message || 'Could not load fare detail' })

  /** @type {Record<string, { kind: string, amountCents: number, status: string }[]>} */
  const paymentsByTrip = {}
  for (const row of payments || []) {
    if (!row.trip_id) continue
    const list = paymentsByTrip[row.trip_id] || []
    list.push({
      kind: row.kind,
      amountCents: Number(row.amount_cents) || 0,
      status: row.status,
    })
    paymentsByTrip[row.trip_id] = list
  }

  /** @type {Record<string, object>} */
  const billsByTrip = {}
  for (const row of bills || []) {
    if (!row.trip_id) continue
    const cur = billsByTrip[row.trip_id] || {
      baseCents: 0,
      distanceCents: 0,
      timeCents: 0,
      surgeCents: 0,
      distanceM: null,
      durationS: null,
    }
    cur.baseCents += Number(row.base_cents) || 0
    cur.distanceCents += Number(row.distance_cents) || 0
    cur.timeCents += Number(row.time_cents) || 0
    cur.surgeCents += Number(row.surge_cents) || 0
    if (!cur.distanceM && row.distance_m) cur.distanceM = Number(row.distance_m)
    if (!cur.durationS && row.duration_s) cur.durationS = Number(row.duration_s)
    billsByTrip[row.trip_id] = cur
  }

  return json(res, 200, { paymentsByTrip, billsByTrip })
}
