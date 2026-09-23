/**
 * Rider prepaid credits. Prefers the `apply_credit_delta` RPC from
 * supabase/payment_failure_hardening.sql, then credit_accounts, then
 * profiles.credit_balance_cents. Missing schema is reported — never treated
 * as a successful $0 debit.
 */

function missingRelation(error) {
  return /relation|does not exist|schema cache|could not find/i.test(error?.message || '')
}

function missingColumn(error) {
  return /column|schema cache|credit_balance/i.test(error?.message || '')
}

export function memoryCreditStore(initial = {}) {
  const balances = new Map(Object.entries(initial).map(([id, cents]) => [id, Math.round(Number(cents) || 0)]))
  const ledger = []
  return {
    async getCredits(userId) {
      return { balanceCents: balances.get(userId) || 0, unavailable: false }
    },
    async applyCredits(userId, deltaCents, meta = {}) {
      const delta = Math.round(Number(deltaCents) || 0)
      if (meta.idempotencyKey && ledger.some((row) => row.idempotencyKey === meta.idempotencyKey)) {
        return { ok: true, duplicate: true, balanceCents: balances.get(userId) || 0 }
      }
      const current = balances.get(userId) || 0
      const next = current + delta
      if (next < 0) return { ok: false, code: 'credits_insufficient', balanceCents: current }
      balances.set(userId, next)
      ledger.push({ userId, delta, idempotencyKey: meta.idempotencyKey || null, kind: meta.kind || null })
      return { ok: true, balanceCents: next }
    },
  }
}

export function supabaseCreditStore(sb) {
  return {
    async getCredits(userId) {
      if (!sb || !userId) return { balanceCents: 0, unavailable: true }
      const acct = await sb.from('credit_accounts').select('balance_cents').eq('user_id', userId).maybeSingle()
      if (!acct.error && acct.data) {
        return { balanceCents: Math.max(0, Math.round(Number(acct.data.balance_cents) || 0)), unavailable: false }
      }
      if (acct.error && !missingRelation(acct.error)) {
        console.error('[credits] credit_accounts', acct.error.message)
      }
      const prof = await sb.from('profiles').select('credit_balance_cents').eq('id', userId).maybeSingle()
      if (!prof.error && prof.data && prof.data.credit_balance_cents != null) {
        return { balanceCents: Math.max(0, Math.round(Number(prof.data.credit_balance_cents) || 0)), unavailable: false }
      }
      return { balanceCents: 0, unavailable: true }
    },

    async applyCredits(userId, deltaCents, meta = {}) {
      const delta = Math.round(Number(deltaCents) || 0)
      if (!sb || !userId) return { ok: false, code: 'credits_unavailable', balanceCents: 0 }

      const rpc = await sb.rpc('apply_credit_delta', {
        p_user_id: userId,
        p_delta_cents: delta,
        p_kind: meta.kind || 'adjust',
        p_trip_id: meta.tripId || null,
        p_idempotency_key: meta.idempotencyKey || null,
      })
      if (!rpc.error && rpc.data) {
        const row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data
        if (row?.ok === false) {
          return { ok: false, code: row.code || 'credits_insufficient', balanceCents: row.balance_cents || 0 }
        }
        if (row && (row.ok === true || row.balance_cents != null)) {
          return {
            ok: true,
            duplicate: Boolean(row.duplicate),
            balanceCents: Math.max(0, Math.round(Number(row.balance_cents) || 0)),
          }
        }
      }
      if (rpc.error && !missingRelation(rpc.error) && !/function|apply_credit_delta/i.test(rpc.error.message || '')) {
        console.error('[credits] rpc', rpc.error.message)
      }

      const current = await this.getCredits(userId)
      if (current.unavailable) return { ok: false, code: 'credits_unavailable', balanceCents: 0 }
      if (meta.idempotencyKey) {
        const existing = await sb
          .from('credit_ledger')
          .select('id, balance_after')
          .eq('idempotency_key', meta.idempotencyKey)
          .maybeSingle()
        if (!existing.error && existing.data) {
          return { ok: true, duplicate: true, balanceCents: existing.data.balance_after ?? current.balanceCents }
        }
      }
      const next = current.balanceCents + delta
      if (next < 0) return { ok: false, code: 'credits_insufficient', balanceCents: current.balanceCents }

      const upsert = await sb.from('credit_accounts').upsert({
        user_id: userId,
        balance_cents: next,
        updated_at: new Date().toISOString(),
      })
      if (upsert.error && !missingRelation(upsert.error)) {
        console.error('[credits] upsert', upsert.error.message)
        return { ok: false, code: 'credits_unavailable', balanceCents: current.balanceCents }
      }
      if (upsert.error && missingRelation(upsert.error)) {
        const prof = await sb.from('profiles').update({ credit_balance_cents: next }).eq('id', userId)
        if (prof.error) {
          if (!missingColumn(prof.error)) console.error('[credits] profile', prof.error.message)
          return { ok: false, code: 'credits_unavailable', balanceCents: current.balanceCents }
        }
      } else {
        await sb.from('profiles').update({ credit_balance_cents: next }).eq('id', userId)
        await sb.from('credit_ledger').insert({
          user_id: userId,
          delta_cents: delta,
          balance_after: next,
          trip_id: meta.tripId || null,
          kind: meta.kind || 'adjust',
          idempotency_key: meta.idempotencyKey || null,
        })
      }
      return { ok: true, balanceCents: next }
    },
  }
}
