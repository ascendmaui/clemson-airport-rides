function isUniqueViolation(error) {
  if (!error) return false
  const code = String(error.code || '')
  const message = String(error.message || '')
  const details = String(error.details || '')
  return (
    code === '23505' ||
    /\b23505\b|duplicate key value violates unique constraint/i.test(message) ||
    /\b23505\b|duplicate key value violates unique constraint/i.test(details)
  )
}

function isSchemaOrColumnError(error) {
  if (!error) return false
  const code = String(error.code || '')
  const message = String(error.message || '')
  const details = String(error.details || '')
  return (
    code === '42703' ||
    code === 'PGRST204' ||
    code === 'PGRST200' ||
    /column|schema cache/i.test(message) ||
    /column|schema cache/i.test(details)
  )
}

/**
 * Ensure a minimal public.profiles row exists for the authed user before
 * foreign-key dependent records (e.g. trips.rider_id) are inserted.
 *
 * @param {object} sb - Supabase client (service role or authenticated)
 * @param {object} user - Supabase auth user ({ id, email, user_metadata, app_metadata })
 * @returns {Promise<{ ok: boolean, created?: boolean, reason?: string, message?: string }>}
 */
export async function ensureProfile(sb, user) {
  if (!sb || !user || typeof user !== 'object' || !user.id) {
    return { ok: false, reason: 'no_user' }
  }

  try {
    const { data: existing, error: selectError } = await sb
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .maybeSingle()

    if (selectError) {
      return {
        ok: false,
        reason: 'profile_upsert_failed',
        message: selectError.message || String(selectError),
      }
    }

    if (existing) {
      return { ok: true, created: false }
    }

    const meta = user.user_metadata || {}
    const fullName = meta.full_name || meta.name || null
    const email = user.email ?? null
    const row = {
      id: user.id,
      email,
      full_name: fullName,
      role: 'rider',
    }

    const { error: upsertError } = await sb
      .from('profiles')
      .upsert(row, { onConflict: 'id', ignoreDuplicates: true })

    if (!upsertError) {
      return { ok: true, created: true }
    }

    if (isUniqueViolation(upsertError)) {
      return { ok: true, created: false }
    }

    if (isSchemaOrColumnError(upsertError)) {
      const fallbackRow = {
        id: user.id,
        email,
      }
      const { error: retryError } = await sb
        .from('profiles')
        .upsert(fallbackRow, { onConflict: 'id', ignoreDuplicates: true })

      if (!retryError) {
        return { ok: true, created: true }
      }

      if (isUniqueViolation(retryError)) {
        return { ok: true, created: false }
      }

      return {
        ok: false,
        reason: 'profile_upsert_failed',
        message: retryError.message || String(retryError),
      }
    }

    return {
      ok: false,
      reason: 'profile_upsert_failed',
      message: upsertError.message || String(upsertError),
    }
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: true, created: false }
    }
    return {
      ok: false,
      reason: 'profile_upsert_failed',
      message: err?.message || String(err),
    }
  }
}
