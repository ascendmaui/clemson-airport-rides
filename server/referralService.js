/**
 * Referral code mint, apply, summary, and credit-grant RPC.
 * Server-only — uses the service role. Never import from the Vite client.
 */
import { randomBytes } from 'node:crypto'
import {
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  REFERRAL_CODE_PREFIX,
  REFERRAL_REFEREE_CENTS,
  REFERRAL_REFERRER_CENTS,
  firstNameOnly,
  isValidReferralCode,
  normalizeReferralCode,
  referralPath,
} from './referralCredits.js'

export function generateReferralCode() {
  const bytes = randomBytes(REFERRAL_CODE_LENGTH)
  let body = ''
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i += 1) {
    body += REFERRAL_CODE_ALPHABET[bytes[i] % REFERRAL_CODE_ALPHABET.length]
  }
  return `${REFERRAL_CODE_PREFIX}${body}`
}

function fail(status, error) {
  return { status, body: { error } }
}

async function completedTripCount(sb, userId) {
  const { count, error } = await sb
    .from('trips')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'completed')
    .or(`rider_id.eq.${userId},driver_id.eq.${userId}`)
  if (error) throw new Error(error.message)
  return count || 0
}

export async function ensureReferralCode(sb, userId) {
  const existing = await sb
    .from('referrals')
    .select('id, code')
    .eq('referrer_id', userId)
    .is('referee_id', null)
    .maybeSingle()
  if (existing.error) throw new Error(existing.error.message)
  if (existing.data?.code) return existing.data

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = generateReferralCode()
    const inserted = await sb
      .from('referrals')
      .insert({
        code,
        referrer_id: userId,
        referee_id: null,
        status: 'pending',
      })
      .select('id, code')
      .maybeSingle()
    if (!inserted.error && inserted.data?.code) return inserted.data

    const message = inserted.error?.message || ''
    const race = /duplicate|unique/i.test(message)
    if (!race && inserted.error) throw new Error(message)

    const again = await sb
      .from('referrals')
      .select('id, code')
      .eq('referrer_id', userId)
      .is('referee_id', null)
      .maybeSingle()
    if (again.data?.code) return again.data
    if (again.error) throw new Error(again.error.message)
  }
  throw new Error('Could not mint a referral code')
}

async function firstNamesById(sb, ids) {
  const unique = [...new Set(ids.filter(Boolean))]
  const map = new Map()
  if (!unique.length) return map
  const { data, error } = await sb
    .from('profiles')
    .select('id, full_name')
    .in('id', unique)
  if (error) throw new Error(error.message)
  for (const row of data || []) {
    map.set(row.id, firstNameOnly(row.full_name))
  }
  return map
}

export async function referralSummary(sb, userId) {
  const anchor = await ensureReferralCode(sb, userId)
  const [rowsRes, ledgerRes, completed] = await Promise.all([
    sb
      .from('referrals')
      .select('id, code, referrer_id, referee_id, status, qualify_role, rewarded_at, created_at')
      .or(`referrer_id.eq.${userId},referee_id.eq.${userId}`)
      .order('created_at', { ascending: false }),
    sb
      .from('credit_ledger')
      .select('amount_cents, reason, created_at')
      .eq('profile_id', userId)
      .order('created_at', { ascending: false }),
    completedTripCount(sb, userId),
  ])
  if (rowsRes.error) throw new Error(rowsRes.error.message)
  if (ledgerRes.error) throw new Error(ledgerRes.error.message)

  const rows = rowsRes.data || []
  const names = await firstNamesById(sb, rows.flatMap((row) => [row.referrer_id, row.referee_id]))
  const incoming = rows.find((row) => row.referee_id === userId) || null
  const sent = rows.filter((row) => row.referrer_id === userId && row.referee_id)
  const ledgerRows = ledgerRes.data || []
  const balanceCents = ledgerRows.reduce((sum, row) => sum + (Number(row.amount_cents) || 0), 0)

  return {
    status: 200,
    body: {
      code: anchor.code,
      path: referralPath(anchor.code),
      referrerCents: REFERRAL_REFERRER_CENTS,
      refereeCents: REFERRAL_REFEREE_CENTS,
      balanceCents,
      canApply: !incoming && completed === 0,
      referredBy: incoming
        ? {
          firstName: names.get(incoming.referrer_id) || 'Friend',
          status: incoming.status,
          qualifyRole: incoming.qualify_role,
        }
        : null,
      referrals: sent.map((row) => ({
        id: row.id,
        firstName: names.get(row.referee_id) || 'Friend',
        status: row.status,
        qualifyRole: row.qualify_role,
        rewardedAt: row.rewarded_at,
        createdAt: row.created_at,
      })),
      ledger: ledgerRows.slice(0, 20).map((row) => ({
        amountCents: row.amount_cents,
        reason: row.reason,
        createdAt: row.created_at,
      })),
    },
  }
}

export async function applyReferralCode(sb, userId, rawCode) {
  const code = normalizeReferralCode(rawCode)
  if (!isValidReferralCode(code)) {
    return fail(400, 'Enter a referral code like TGR-ABC234.')
  }

  const anchorRes = await sb
    .from('referrals')
    .select('id, referrer_id, code')
    .eq('code', code)
    .is('referee_id', null)
    .maybeSingle()
  if (anchorRes.error) throw new Error(anchorRes.error.message)
  if (!anchorRes.data) return fail(404, 'That referral code doesn’t match an account.')
  if (anchorRes.data.referrer_id === userId) {
    return fail(400, 'You can’t use your own referral code.')
  }

  const existing = await sb
    .from('referrals')
    .select('id')
    .eq('referee_id', userId)
    .maybeSingle()
  if (existing.error) throw new Error(existing.error.message)
  if (existing.data) return fail(409, 'A referral is already attached to this account.')

  const completed = await completedTripCount(sb, userId)
  if (completed > 0) {
    return fail(400, 'Referral credits are for new riders and drivers before their first completed trip.')
  }

  const inserted = await sb
    .from('referrals')
    .insert({
      code,
      referrer_id: anchorRes.data.referrer_id,
      referee_id: userId,
      status: 'pending',
    })
    .select('id')
    .maybeSingle()
  if (inserted.error) {
    if (/duplicate|unique/i.test(inserted.error.message || '')) {
      return fail(409, 'A referral is already attached to this account.')
    }
    throw new Error(inserted.error.message)
  }

  const names = await firstNamesById(sb, [anchorRes.data.referrer_id])
  return {
    status: 200,
    body: {
      applied: true,
      referrerFirstName: names.get(anchorRes.data.referrer_id) || 'Friend',
      referrerCents: REFERRAL_REFERRER_CENTS,
      refereeCents: REFERRAL_REFEREE_CENTS,
    },
  }
}

export async function previewReferralCode(sb, rawCode) {
  const code = normalizeReferralCode(rawCode)
  if (!isValidReferralCode(code)) {
    return { status: 200, body: { valid: false } }
  }
  const anchorRes = await sb
    .from('referrals')
    .select('referrer_id')
    .eq('code', code)
    .is('referee_id', null)
    .maybeSingle()
  if (anchorRes.error) throw new Error(anchorRes.error.message)
  if (!anchorRes.data) return { status: 200, body: { valid: false } }
  const names = await firstNamesById(sb, [anchorRes.data.referrer_id])
  return {
    status: 200,
    body: {
      valid: true,
      referrerFirstName: names.get(anchorRes.data.referrer_id) || 'Friend',
      referrerCents: REFERRAL_REFERRER_CENTS,
      refereeCents: REFERRAL_REFEREE_CENTS,
    },
  }
}

export async function qualifyReferralTrip(sb, userId, tripId) {
  if (!tripId || !/^[0-9a-f-]{36}$/i.test(String(tripId))) {
    return fail(400, 'A completed trip id is required.')
  }
  const tripRes = await sb
    .from('trips')
    .select('id, rider_id, driver_id, status')
    .eq('id', tripId)
    .maybeSingle()
  if (tripRes.error) throw new Error(tripRes.error.message)
  const trip = tripRes.data
  if (!trip) return fail(404, 'Trip not found.')
  if (trip.rider_id !== userId && trip.driver_id !== userId) {
    return fail(403, 'Only people on this trip can confirm referral credit.')
  }
  if (trip.status !== 'completed' || !trip.driver_id) {
    return fail(409, 'Referral credit waits until the trip is completed.')
  }

  const { data, error } = await sb.rpc('grant_referral_credits', {
    p_trip_id: trip.id,
    p_referrer_cents: REFERRAL_REFERRER_CENTS,
    p_referee_cents: REFERRAL_REFEREE_CENTS,
  })
  if (error) throw new Error(error.message)
  return {
    status: 200,
    body: {
      ok: true,
      granted: data?.granted || [],
      referrerCents: REFERRAL_REFERRER_CENTS,
      refereeCents: REFERRAL_REFEREE_CENTS,
    },
  }
}
