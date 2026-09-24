/**
 * Store which signed-in rider arrived through /a/:code.
 * Writes ambassador_attributions only. The payout ledger stays in carpoolSettle,
 * which runs after a completed carpool — opening a link does not create a payout.
 */
import { AMBASSADOR_CODE_TYPE, normalizeAmbassadorCode } from '../packages/rides-native/shared/ambassadorAttribution.js'

function missingTable(error) {
  return /relation|does not exist|schema cache/i.test(error?.message || '')
}

async function lookupAmbassadorCode(sb, code, user) {
  const normalized = normalizeAmbassadorCode(code)
  if (!normalized || !sb) return { code: null }
  const found = await sb
    .from('ambassador_codes')
    .select('code, code_type, profile_id')
    .eq('code', normalized)
    .maybeSingle()
  if (found.error) {
    if (missingTable(found.error)) return { code: null, schemaMissing: true }
    return { code: null, error: found.error.message }
  }
  if (!found.data || found.data.code_type !== AMBASSADOR_CODE_TYPE) return { code: null }
  if (user?.id && found.data.profile_id === user.id) {
    return { code: null, ownLink: true }
  }
  return { code: found.data.code }
}

/** Real ambassador code for this rider, or null. Never the rider's own link. */
export async function resolveAmbassadorCode(sb, user, explicit) {
  const direct = await lookupAmbassadorCode(sb, explicit, user)
  if (direct.code) return direct.code
  if (direct.ownLink || direct.schemaMissing || !user?.id || !sb) return null
  const stored = await sb
    .from('ambassador_attributions')
    .select('code')
    .eq('user_id', user.id)
    .maybeSingle()
  if (stored.error || !stored.data?.code) return null
  const fromStore = await lookupAmbassadorCode(sb, stored.data.code, user)
  return fromStore.code || null
}

export async function saveAmbassadorAttribution(sb, user, rawCode) {
  const code = normalizeAmbassadorCode(rawCode)
  if (!code) return { ok: false, error: 'Ambassador code required' }
  if (!user?.id) return { ok: false, error: 'Sign in required' }
  const found = await lookupAmbassadorCode(sb, code, user)
  if (found.schemaMissing) {
    return { ok: false, code: 'schema_missing', error: 'Ambassador tables are not migrated yet.' }
  }
  if (found.error) return { ok: false, error: found.error }
  if (found.ownLink) {
    return { ok: false, code: 'own_link', error: 'This is your ambassador link. Share it with riders.' }
  }
  if (!found.code) return { ok: false, error: 'That ambassador link is not active.' }
  const saved = await sb.from('ambassador_attributions').upsert({
    user_id: user.id,
    code: found.code,
    code_type: AMBASSADOR_CODE_TYPE,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
  if (saved.error) {
    if (missingTable(saved.error)) {
      return { ok: true, code: found.code, code_type: AMBASSADOR_CODE_TYPE, stored: false }
    }
    return { ok: false, error: saved.error.message }
  }
  return { ok: true, code: found.code, code_type: AMBASSADOR_CODE_TYPE, stored: true }
}

/** Attach a code to a carpool that does not have one yet. Does not write the ledger. */
export async function stampAmbassadorCode(sb, ride, code) {
  const next = normalizeAmbassadorCode(code)
  if (!sb || !ride?.id || !next) return ride
  if (ride.kind && ride.kind !== 'carpool') return ride
  if (normalizeAmbassadorCode(ride.fare_breakdown?.ambassador_code)) return ride
  const fare_breakdown = { ...(ride.fare_breakdown || {}), ambassador_code: next }
  const { error } = await sb.from('friend_rides').update({ fare_breakdown }).eq('id', ride.id)
  if (error) return ride
  return { ...ride, fare_breakdown }
}
