/**
 * Driver perks: config, bonus ledger awards and payouts.
 * Ledger rows are the source of truth for bonus money. Transfers use the
 * row id as the Stripe idempotency key so a retry never pays twice.
 */
import { loadConnectAccount } from './payouts.js'

export async function loadPerkConfig(sb, key, fallback = {}) {
  const res = await sb.from('driver_perk_config').select('value').eq('key', key).maybeSingle()
  if (res.error || !res.data) return fallback
  return res.data.value && typeof res.data.value === 'object' ? res.data.value : fallback
}

/** Insert earned bonuses; existing (kind, driver_id, ref) rows are left alone. */
export async function awardBonuses(sb, driverId, awards) {
  const rows = (awards || []).filter((a) => a && a.amountCents > 0).map((a) => ({
    driver_id: driverId, kind: a.kind, ref: a.ref, amount_cents: a.amountCents,
    trip_id: a.tripId || null, metadata: a.metadata || {},
  }))
  if (!rows.length) return { inserted: 0 }
  const res = await sb.from('driver_bonus_ledger').upsert(rows, { onConflict: 'kind,driver_id,ref', ignoreDuplicates: true })
  if (res.error) throw new Error(res.error.message)
  return { inserted: rows.length }
}

/** Pay pending bonus rows. Called from the daily payout sweep. */
export async function payBonusLedger(sb, stripe, { limit = 100, loadAccount = loadConnectAccount, now = new Date() } = {}) {
  const listed = await sb.from('driver_bonus_ledger').select('*').in('status', ['pending', 'failed']).order('created_at').limit(limit)
  if (listed.error) return [{ ok: false, error: listed.error.message }]
  const results = []
  for (const row of listed.data || []) {
    if (row.attempts >= 5) continue
    const account = await loadAccount(sb, row.driver_id)
    let patch
    if (!account) {
      patch = { status: 'failed', attempts: row.attempts + 1, last_error: 'no_connect_account' }
    } else {
      try {
        const tr = await stripe.transfers.create({
          amount: row.amount_cents, currency: 'usd', destination: account,
          transfer_group: `bonus:${row.id}`, metadata: { bonusId: row.id, kind: row.kind, driverId: row.driver_id },
        }, { idempotencyKey: `bonus:${row.id}` })
        patch = { status: 'paid', attempts: row.attempts + 1, last_error: null, stripe_transfer_id: tr.id, paid_at: now.toISOString() }
      } catch (err) {
        patch = { status: 'failed', attempts: row.attempts + 1, last_error: err?.message || 'transfer_failed' }
      }
    }
    await sb.from('driver_bonus_ledger').update(patch).eq('id', row.id).in('status', ['pending', 'failed'])
    results.push({ bonusId: row.id, kind: row.kind, ok: patch.status === 'paid', status: patch.status })
  }
  return results
}

export async function loadDriverTrips(sb, driverId, { limit = 500 } = {}) {
  const [own, cancels] = await Promise.all([
    sb.from('trips').select('id, driver_id, status, completed_at, metadata')
      .eq('driver_id', driverId).eq('status', 'completed').order('completed_at', { ascending: false }).limit(limit),
    sb.from('trips').select('id, driver_id, status, completed_at, metadata')
      .contains('metadata', { driver_cancels: [{ driver_id: driverId }] }).limit(limit),
  ])
  if (own.error) throw new Error(own.error.message)
  const map = new Map()
  for (const t of [...(own.data || []), ...(cancels.error ? [] : cancels.data || [])]) map.set(t.id, t)
  return [...map.values()]
}
