/**
 * Rental request lifecycle (v1, no payments on platform).
 * requested -> accepted | declined | canceled
 * accepted  -> active | canceled
 * active    -> ended
 * Mirrors public.rental_request_transition() in the migration.
 */
export const RENTAL_STATUSES = ['requested', 'accepted', 'declined', 'active', 'ended', 'canceled']
export const TERMINAL = new Set(['declined', 'ended', 'canceled'])

const RULES = {
  requested: { accepted: ['partner'], declined: ['partner'], canceled: ['driver'] },
  accepted: { active: ['partner'], canceled: ['driver', 'partner'] },
  active: { ended: ['partner', 'driver'] },
}

export function canTransition(from, to, actor) {
  if (actor === 'admin') return Boolean(RULES[from]?.[to])
  return Boolean(RULES[from]?.[to]?.includes(actor))
}

export function nextStatuses(from, actor) {
  return Object.keys(RULES[from] || {}).filter((to) => canTransition(from, to, actor))
}

/** Returns the patch to apply or throws with a readable message. */
export function applyTransition(row, to, actor, { startDate, endDate, now = new Date() } = {}) {
  if (!row || !RENTAL_STATUSES.includes(row.status)) throw new Error('Unknown rental request.')
  if (!canTransition(row.status, to, actor)) throw new Error(`Cannot move a ${row.status} request to ${to}.`)
  const ts = now.toISOString()
  const day = ts.slice(0, 10)
  const patch = { status: to, updated_at: ts }
  if (to === 'accepted') patch.accepted_at = ts
  if (to === 'active') {
    patch.start_date = startDate || row.start_date || day
    if (endDate) {
      if (endDate < patch.start_date) throw new Error('End date cannot be before start date.')
      patch.end_date = endDate
    }
  }
  if (to === 'ended') {
    patch.end_date = endDate || day
    if (row.start_date && patch.end_date < row.start_date) throw new Error('End date cannot be before start date.')
  }
  return patch
}

/** Driver contact is visible to the partner only after they accept. */
export function contactVisible(status) {
  return status === 'accepted' || status === 'active' || status === 'ended'
}
