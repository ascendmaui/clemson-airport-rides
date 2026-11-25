#!/usr/bin/env node
/**
 * Yesterday's (ET) below-margin rides, for a daily alert.
 *
 *   node scripts/pricing/margin-report.mjs          # human summary
 *   node scripts/pricing/margin-report.mjs --json   # for a cron/alert hook
 *   node scripts/pricing/margin-report.mjs --date 2026-10-17T12:00:00-04:00   # "yesterday" relative to this time
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY (+ SUPABASE_URL). Reads public.pricing_margin_alerts
 * only. Sends nothing; exit code 3 when there were below-target rides, so a
 * scheduler can decide to notify. Secrets are never printed.
 */
import process from 'node:process'
import { summarizeMarginAlerts, yesterdayEtRange } from '../../server/marginAlerts.js'

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes('--json')
const dateIdx = argv.indexOf('--date')
const now = dateIdx >= 0 ? new Date(argv[dateIdx + 1]) : new Date()

function usd(c) {
  return `$${((c || 0) / 100).toFixed(2)}`
}

async function main() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) {
    console.error('Set SUPABASE_SERVICE_ROLE_KEY (and SUPABASE_URL).')
    process.exit(1)
  }
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(process.env.SUPABASE_URL || 'https://awktabuhijrshmsmagpq.supabase.co', key, { auth: { persistSession: false } })
  const range = yesterdayEtRange(now)
  const res = await sb.from('pricing_margin_alerts').select('*')
    .gte('created_at', range.start.toISOString()).lt('created_at', range.end.toISOString())
    .order('created_at', { ascending: true }).limit(5000)
  if (res.error) {
    console.error(`read failed: ${res.error.message}`)
    process.exit(1)
  }
  const summary = summarizeMarginAlerts(res.data)
  if (JSON_OUT) {
    console.log(JSON.stringify({ day: range.label, timeZone: 'America/New_York', ...summary }, null, 2))
  } else {
    console.log(`Below-margin report for ${range.label} (ET)`)
    console.log(`  rides under target: ${summary.belowTargetRides} (unprofitable: ${summary.unprofitableRides}, total loss ${usd(summary.lossCents)}, short of target by ${usd(summary.shortfallVsTargetCents)})`)
    console.log(`  quotes under target: ${summary.belowTargetQuotes}; blocked --apply runs: ${summary.blockedApplyRuns}`)
    for (const [tier, t] of Object.entries(summary.tiers)) {
      console.log(`  ${tier}: ${t.rides} rides, fares ${usd(t.fareCents)}, profit ${usd(t.profitCents)}, worst margin ${(t.worstMarginBps / 100).toFixed(1)}%`)
    }
  }
  if (summary.belowTargetRides > 0) process.exit(3)
}

main().catch((error) => {
  console.error(String(error?.message || error))
  process.exit(1)
})
