/**
 * Cumulative Tiger Heat margin ledger.
 *
 * Counts reserved and settled trips. Released rows drop out, so a cancel
 * gives the bonus budget back before another zone is committed.
 *
 * When Supabase has tiger_heat_ledger, that table is the source of truth.
 * Otherwise the process keeps an in-memory ledger so local dev and tests
 * still enforce the same guard.
 */

import { randomUUID } from 'node:crypto'

const memory = new Map()
let tail = Promise.resolve()

/**
 * Serializes reserve, settle, and release in this process so two trips
 * cannot both spend the same margin before either commit lands.
 */
export function withLedgerLock(work) {
  const run = tail.then(() => work(), () => work())
  tail = run.then(() => undefined, () => undefined)
  return run
}

export function resetTigerHeatLedger() {
  memory.clear()
  tail = Promise.resolve()
}

export function marginFromEntries(entries) {
  let revenueCents = 0
  let driverPayCents = 0
  for (const entry of entries || []) {
    if (!entry || entry.status === 'released') continue
    revenueCents += Math.round(Number(entry.revenue_cents ?? entry.revenueCents) || 0)
    driverPayCents += Math.round(Number(entry.driver_pay_cents ?? entry.driverPayCents) || 0)
  }
  return {
    revenueCents,
    driverPayCents,
    marginCents: revenueCents - driverPayCents,
  }
}

function asEntry(row) {
  if (!row) return null
  const reservationId = row.reservation_id || row.reservationId
  if (!reservationId) return null
  return {
    reservationId,
    tripId: row.trip_id || row.tripId || null,
    zoneId: row.zone_id || row.zoneId || null,
    status: row.status || 'reserved',
    riderFareCents: Math.round(Number(row.rider_fare_cents ?? row.riderFareCents) || 0),
    insuranceCents: Math.round(Number(row.insurance_cents ?? row.insuranceCents) || 0),
    taxCents: Math.round(Number(row.tax_cents ?? row.taxCents) || 0),
    revenueCents: Math.round(Number(row.revenue_cents ?? row.revenueCents) || 0),
    driverBaseCents: Math.round(Number(row.driver_base_cents ?? row.driverBaseCents) || 0),
    bonusCents: Math.round(Number(row.bonus_cents ?? row.bonusCents) || 0),
    driverPayCents: Math.round(Number(row.driver_pay_cents ?? row.driverPayCents) || 0),
    platformFeeCents: Math.round(Number(row.platform_fee_cents ?? row.platformFeeCents) || 0),
    platformFundedCents: Math.round(Number(row.platform_funded_cents ?? row.platformFundedCents) || 0),
  }
}

function toRow(entry) {
  return {
    reservation_id: entry.reservationId,
    trip_id: entry.tripId,
    zone_id: entry.zoneId,
    status: entry.status,
    rider_fare_cents: entry.riderFareCents,
    insurance_cents: entry.insuranceCents,
    tax_cents: entry.taxCents,
    revenue_cents: entry.revenueCents,
    driver_base_cents: entry.driverBaseCents,
    bonus_cents: entry.bonusCents,
    driver_pay_cents: entry.driverPayCents,
    platform_fee_cents: entry.platformFeeCents,
    platform_funded_cents: entry.platformFundedCents,
  }
}

async function readRemote(sb) {
  if (!sb?.from) return null
  try {
    let query = sb.from('tiger_heat_ledger').select('*')
    if (typeof query.limit === 'function') query = query.limit(5000)
    const result = await query
    if (!result || result.error || !Array.isArray(result.data)) return null
    return result.data.map(asEntry).filter(Boolean)
  } catch {
    return null
  }
}

async function writeRemote(sb, entry) {
  if (!sb?.from) return
  try {
    const table = sb.from('tiger_heat_ledger')
    const row = toRow(entry)
    if (typeof table.upsert === 'function') {
      await table.upsert(row, { onConflict: 'reservation_id' })
      return
    }
    await table.insert(row)
  } catch {
    /* memory ledger still holds the commit */
  }
}

export async function loadLedger(sb) {
  if (memory.size === 0) {
    const remote = await readRemote(sb)
    if (remote) {
      for (const entry of remote) memory.set(entry.reservationId, entry)
    }
  }
  return {
    entries: [...memory.values()],
    ...marginFromEntries([...memory.values()]),
  }
}

export async function loadTigerHeatConfigRow(sb) {
  if (!sb?.from) return null
  try {
    let query = sb.from('tiger_heat_config').select('*')
    if (typeof query.limit === 'function') query = query.limit(1)
    const result = await query
    if (!result || result.error || !Array.isArray(result.data) || !result.data.length) return null
    return result.data[0]
  } catch {
    return null
  }
}

export function rememberEntry(entry) {
  memory.set(entry.reservationId, entry)
  return entry
}

export async function commitEntry(sb, entry) {
  rememberEntry(entry)
  await writeRemote(sb, entry)
  return entry
}

export function newReservationId() {
  return randomUUID()
}

export function ledgerExcluding(ledger, reservationId) {
  const entries = (ledger?.entries || []).filter((entry) => entry.reservationId !== reservationId)
  return { entries, ...marginFromEntries(entries) }
}
