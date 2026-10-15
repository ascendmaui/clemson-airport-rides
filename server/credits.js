/**
 * Rider prepaid credits. rider_credit_lots is the single source of truth
 * (supabase/migrations/20261015120000_credit_lots_canonical_bigint.sql).
 * Reads sum the available lots; every change goes through the
 * `apply_credit_delta` RPC, which debits lots FIFO, journals the op in
 * wallet_ledger and honours idempotency keys. There is no client-side
 * fallback write: if the RPC fails the change is refused, never guessed.
 * credit_accounts is a frozen legacy table and is not read or written.
 */

export function memoryCreditStore(initial = {}) {
  const balances = new Map(Object.entries(initial).map(([id, cents]) => [id, Math.round(Number(cents) || 0)]))
  const ledger = []
  return {
    async getCredits(userId) {
      return { balanceCents: balances.get(userId) || 0, unavailable: false }
    },
    async applyCredits(userId, deltaCents, meta = {}) {
      const delta = Math.round(Number(deltaCents) || 0)
      const prior = meta.idempotencyKey ? ledger.find((row) => row.idempotencyKey === meta.idempotencyKey) : null
      if (prior) {
        if (prior.userId !== userId || prior.delta !== delta) {
          return { ok: false, code: 'idempotency_conflict', balanceCents: balances.get(userId) || 0 }
        }
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
      const { data, error } = await sb
        .from('rider_credit_lots')
        .select('remaining_cents')
        .eq('profile_id', userId)
        .eq('status', 'available')
      if (error) {
        console.error('[credits] rider_credit_lots', error.message)
        return { balanceCents: 0, unavailable: true }
      }
      const balanceCents = (data || []).reduce((sum, row) => sum + Math.max(0, Math.round(Number(row.remaining_cents) || 0)), 0)
      return { balanceCents, unavailable: false }
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
      if (rpc.error) {
        console.error('[credits] apply_credit_delta', rpc.error.message)
        return { ok: false, code: 'credits_unavailable', balanceCents: 0 }
      }
      const row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data
      const balanceCents = Math.max(0, Math.round(Number(row?.balance_cents) || 0))
      if (!row || row.ok !== true) {
        return { ok: false, code: row?.code || 'credits_unavailable', balanceCents }
      }
      return { ok: true, duplicate: Boolean(row.duplicate), balanceCents }
    },
  }
}
