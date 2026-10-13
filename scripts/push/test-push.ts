/**
 * Send one test push to a user's stored Expo tokens and print the receipts.
 * Run from the repo root:
 *   node --experimental-strip-types scripts/push/test-push.ts --user <uuid>
 * Receipts that are still pending can be fetched later:
 *   node --experimental-strip-types scripts/push/test-push.ts --tickets <id,id>
 */
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { pollExpoPushReceipts, sendExpoPush } from '../../server/expoPush.js'

const EXPO_TOKEN = /^Expo(nent)?PushToken\[/

export type StoredPushToken = {
  role: 'rider' | 'driver'
  token: string
  platform: string | null
  source: 'rider_push_tokens' | 'driver_push_tokens' | 'driver_status'
}

type QueryError = { message?: string; code?: string } | null
type QueryResult = { data?: unknown; error?: QueryError }

export function redactToken(token: string) {
  const value = String(token || '')
  if (value.length < 16) return 'redacted'
  // Keep a short tail for support. Do not print the Expo token scheme.
  return `token…${value.slice(-4)}`
}

function rowsOf(result: QueryResult | null | undefined) {
  if (!result || result.error || !Array.isArray(result.data)) return []
  return result.data
}

export async function loadStoredPushTokens(sb: { from: (table: string) => unknown }, userId: string): Promise<StoredPushToken[]> {
  const id = String(userId || '').trim()
  if (!id) return []
  const found: StoredPushToken[] = []
  const seen = new Set<string>()
  function add(role: StoredPushToken['role'], token: unknown, platform: unknown, source: StoredPushToken['source']) {
    const value = String(token || '').trim()
    if (!EXPO_TOKEN.test(value) || seen.has(value)) return
    seen.add(value)
    found.push({ role, token: value, platform: platform ? String(platform) : null, source })
  }
  const rider = await (sb.from('rider_push_tokens') as { select: (cols: string) => { eq: (col: string, val: string) => Promise<QueryResult> } })
    .select('token, platform')
    .eq('rider_id', id)
  for (const row of rowsOf(rider) as { token?: string; platform?: string }[]) add('rider', row.token, row.platform, 'rider_push_tokens')
  const driver = await (sb.from('driver_push_tokens') as { select: (cols: string) => { eq: (col: string, val: string) => Promise<QueryResult> } })
    .select('token, platform')
    .eq('driver_id', id)
  for (const row of rowsOf(driver) as { token?: string; platform?: string }[]) add('driver', row.token, row.platform, 'driver_push_tokens')
  try {
    const legacy = await (sb.from('driver_status') as { select: (cols: string) => { eq: (col: string, val: string) => { maybeSingle: () => Promise<QueryResult> } } })
      .select('expo_push_token')
      .eq('driver_id', id)
      .maybeSingle()
    if (!legacy?.error) add('driver', (legacy?.data as { expo_push_token?: string } | null)?.expo_push_token, null, 'driver_status')
  } catch {
    /* The legacy column is optional. */
  }
  return found
}

export async function deliverTestPush({
  tokens,
  title = 'Clemson RIDES test',
  body = 'Push is configured. You can dismiss this.',
  fetchImpl,
  env,
  attempts = 6,
  waitMs = 5000,
  sleep,
}: {
  tokens: StoredPushToken[]
  title?: string
  body?: string
  fetchImpl?: typeof fetch
  env?: NodeJS.ProcessEnv
  attempts?: number
  waitMs?: number
  sleep?: (ms: number) => Promise<void>
}) {
  const sends = []
  for (const token of tokens) {
    const result = await sendExpoPush({
      to: token.token,
      title,
      body,
      data: { kind: 'push_test', role: token.role },
    }, { fetch: fetchImpl, env })
    sends.push({
      role: token.role,
      source: token.source,
      platform: token.platform,
      token: redactToken(token.token),
      sent: result.sent,
      reason: result.reason,
      ticketId: result.ticketId || null,
      detail: result.detail || null,
    })
  }
  const ticketIds = sends.map((row) => row.ticketId).filter((id): id is string => Boolean(id))
  const polled = ticketIds.length
    ? await pollExpoPushReceipts(ticketIds, { fetch: fetchImpl, env, attempts, waitMs, sleep })
    : { ok: true, receipts: {}, pending: [] as string[], attempt: 0 }
  return {
    sends,
    receipts: polled.receipts || {},
    pending: polled.pending || [],
    receiptsOk: polled.ok !== false,
    receiptAttempt: polled.attempt || 0,
  }
}

function arg(name: string) {
  const index = process.argv.indexOf(name)
  if (index < 0) return ''
  return String(process.argv[index + 1] || '').trim()
}

function isDirectRun() {
  const entry = process.argv[1]
  if (!entry) return false
  return import.meta.url === pathToFileURL(entry).href
}

async function main() {
  const tickets = arg('--tickets').split(',').map((id) => id.trim()).filter(Boolean)
  const userId = arg('--user')
  const env = process.env
  if (tickets.length) {
    const polled = await pollExpoPushReceipts(tickets, {
      env,
      attempts: Number(arg('--attempts') || 6),
      waitMs: Number(arg('--wait-ms') || 5000),
    })
    console.log(JSON.stringify({ tickets, receipts: polled.receipts, pending: polled.pending || [], ok: polled.ok }, null, 2))
    process.exit(polled.ok ? 0 : 1)
  }
  if (!userId) {
    console.error('Pass --user <uuid> or --tickets <id,id>.')
    process.exit(2)
  }
  const url = String(env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').trim()
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (!url || !key) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The anon key cannot read push tokens.')
    process.exit(2)
  }
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const tokens = await loadStoredPushTokens(sb, userId)
  if (!tokens.length) {
    console.error('No Expo push token is stored for that user. Open the Rider or Driver app on a phone and allow notifications, then retry.')
    process.exit(1)
  }
  const report = await deliverTestPush({
    tokens,
    title: arg('--title') || undefined,
    body: arg('--body') || undefined,
    env,
    attempts: Number(arg('--attempts') || 6),
    waitMs: Number(arg('--wait-ms') || 5000),
  })
  console.log(JSON.stringify({ userId, ...report }, null, 2))
  const failed = report.sends.some((row) => !row.sent)
  process.exit(failed ? 1 : 0)
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Test push failed')
    process.exit(1)
  })
}
