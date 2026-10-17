#!/usr/bin/env node
/**
 * Clemson Rides vs UberX / Lyft on a basket of real Clemson trips.
 *
 *   node scripts/pricing/compare-competitors.mjs            # report only
 *   node scripts/pricing/compare-competitors.mjs --json     # machine-readable
 *   node scripts/pricing/compare-competitors.mjs --apply    # lower rates if needed (writes config + audit)
 *   node scripts/pricing/compare-competitors.mjs --offline  # in-repo seed only, never touches the DB
 *
 * Data: with SUPABASE_SERVICE_ROLE_KEY (and SUPABASE_URL) set, reads
 * public.pricing_rate_cards, public.competitor_rate_cards, public.pricing_settings.
 * Without it, uses the in-repo seed (src/lib/fareRates.js FARE_CARD,
 * shared/data/competitorRates.js, default settings). Secrets are never printed.
 *
 * --apply only ever lowers rates, never below the driver-pay floors
 * (per mile >= $0.90, per minute >= $0.18, minimum >= $5.00), and never to a
 * point where any basket trip (every tier, carpool per seat, and the 1.25x
 * game-day version) is under the target margin. If a rule blocks the change it
 * writes nothing, records an alert row (pricing_margin_alerts, source
 * 'compare'), prints the trips and numbers, and exits 2.
 */
import process from 'node:process'
import { FARE_CARD } from '../../src/lib/fareRates.js'
import { COMPETITOR_RATES } from '../../shared/data/competitorRates.js'
import { CLEMSON_BASKET, compareBasket, normalizeCard, planCompetitorApply, planMinFare } from '../../shared/pricingCompare.js'
import { defaultSettings, settingsFromRow } from '../../server/pricingConfig.js'

const args = new Set(process.argv.slice(2))
const APPLY = args.has('--apply')
const JSON_OUT = args.has('--json')
const OFFLINE = args.has('--offline')

function usd(cents) {
  return cents == null ? '-' : `$${(cents / 100).toFixed(2)}`
}
function pct(bps) {
  return bps == null ? '-' : `${bps >= 0 ? '+' : ''}${(bps / 100).toFixed(1)}%`
}

function competitorFromRow(row) {
  const card = normalizeCard(row)
  if (!card) return null
  return {
    ...card,
    competitor: row.competitor,
    tier: row.tier,
    ourTier: row.our_tier || 'standard',
    minIncludesBooking: row.min_includes_booking !== false,
    sourceUrl: row.source_url,
  }
}

async function loadDb() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (OFFLINE || !key) return null
  const url = process.env.SUPABASE_URL || 'https://awktabuhijrshmsmagpq.supabase.co'
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(url, key, { auth: { persistSession: false } })
  const [cards, comps, settings] = await Promise.all([
    sb.from('pricing_rate_cards').select('*').eq('active', true),
    sb.from('competitor_rate_cards').select('*').eq('active', true),
    sb.from('pricing_settings').select('*').eq('id', 1),
  ])
  for (const r of [cards, comps, settings]) if (r.error) throw new Error(`Supabase read failed: ${r.error.message}`)
  const byTier = {}
  for (const row of cards.data) {
    const card = normalizeCard(row)
    if (card) byTier[row.tier] = card
  }
  if (!byTier.standard) throw new Error('pricing_rate_cards has no active standard row')
  return {
    sb,
    cards: byTier,
    competitors: comps.data.map(competitorFromRow).filter(Boolean),
    settings: settingsFromRow(settings.data[0]).settings,
    source: 'db',
  }
}

function seed() {
  return {
    sb: null,
    cards: { standard: { ...FARE_CARD } },
    competitors: COMPETITOR_RATES.map((c) => ({ ...c })),
    settings: defaultSettings(),
    source: 'seed',
  }
}

function compareSettings(s) {
  return {
    undercutBps: s.undercutBps,
    floorPerMileCents: s.floors.perMileCents,
    floorPerMinuteCents: s.floors.perMinuteCents,
    floorMinFareCents: s.floors.minFareCents,
    margin: s.margin,
  }
}

function printRows(rows) {
  const head = ['tier', 'trip', 'ours', 'uber', 'lyft', 'vs cheaper', '3% under?', 'margin', 'game-day', 'gd margin']
  const lines = [head]
  for (const r of rows) {
    const uber = r.competitors.find((c) => c.competitor === 'uber')
    const lyft = r.competitors.find((c) => c.competitor === 'lyft')
    lines.push([
      r.tier, r.trip, usd(r.ourCents), usd(uber?.fareCents), usd(lyft?.fareCents), pct(r.diffBps),
      r.meetsUndercut ? 'yes' : 'NO', pct(r.margin.marginBps), usd(r.ourGameDayCents), pct(r.gameDayMargin.marginBps),
    ])
  }
  const widths = head.map((_, i) => Math.max(...lines.map((l) => String(l[i]).length)))
  for (const l of lines) console.log(l.map((v, i) => String(v).padEnd(widths[i])).join('  '))
}

async function recordAlert(sb, alerts) {
  if (!sb) return
  const res = await sb.from('pricing_margin_alerts').insert({
    source: 'compare',
    tier: 'basket',
    details: { alerts, at: new Date().toISOString() },
  })
  if (res.error) console.error(`could not record alert: ${res.error.message}`)
}

async function writeCards(sb, changes, reason) {
  for (const c of changes) {
    const row = {
      tier: c.tier,
      base_cents: c.after.baseCents,
      booking_fee_cents: c.after.bookingFeeCents,
      per_mile_cents: c.after.perMileCents,
      per_minute_cents: c.after.perMinuteCents,
      min_fare_cents: c.after.minFareCents,
      active: true,
      updated_by: 'scripts/pricing/compare-competitors.mjs',
      change_reason: reason,
    }
    const res = await sb.from('pricing_rate_cards').upsert(row, { onConflict: 'tier' })
    if (res.error) throw new Error(`write ${c.tier} failed: ${res.error.message}`)
  }
}

async function main() {
  let data = null
  try {
    data = await loadDb()
  } catch (error) {
    console.error(String(error?.message || error))
    process.exit(1)
  }
  data = data || seed()
  const settings = compareSettings(data.settings)
  const rows = compareBasket({ cards: data.cards, competitors: data.competitors, basket: CLEMSON_BASKET, settings })
  const plan = planCompetitorApply({ cards: data.cards, competitors: data.competitors, basket: CLEMSON_BASKET, settings })
  const minFare = planMinFare({ cards: data.cards, competitors: data.competitors, basket: CLEMSON_BASKET, settings })
  const alerts = [...plan.alerts, ...minFare.alerts]

  if (JSON_OUT) {
    console.log(JSON.stringify({ source: data.source, rows, plan, minFare, alerts }, null, 2))
  } else {
    console.log(`Clemson Rides vs UberX/Lyft (config: ${data.source}; target margin ${data.settings.margin.targetMarginBps / 100}%; undercut ${settings.undercutBps / 100}%)`)
    printRows(rows)
    console.log('')
    if (!plan.needed) console.log('Every basket trip is already at least the undercut below the cheaper competitor.')
    for (const c of plan.proposed) console.log(`proposed ${c.tier}: ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`)
    for (const a of alerts) {
      console.log(`ALERT ${a.kind}: ${a.message}`)
      for (const t of a.trips || []) console.log(`  ${JSON.stringify(t)}`)
    }
  }

  if (!APPLY) return
  if (!data.sb) {
    console.error('--apply needs SUPABASE_SERVICE_ROLE_KEY; nothing written.')
    process.exit(1)
  }
  if (alerts.length) {
    await recordAlert(data.sb, alerts)
    console.error('Blocked: nothing written. Alert recorded for John.')
    process.exit(2)
  }
  if (!plan.ok) {
    console.log('No rate change needed.')
    return
  }
  await writeCards(data.sb, plan.changes, `competitor undercut ${settings.undercutBps / 100}% (${new Date().toISOString()})`)
  console.log(`Applied ${plan.changes.length} card change(s); pricing_config_audit has the before/after.`)
}

main().catch((error) => {
  console.error(String(error?.message || error))
  process.exit(1)
})
