/** Test double for server/userContext.js. Does not query Supabase. */

export const state = {
  context: { signedIn: true, role: 'rider' },
  calls: [],
  throwOnLoad: false,
}

export async function loadUserContext(sb, user) {
  state.calls.push({ sb, user })
  if (state.throwOnLoad) throw new Error('context unavailable')
  return state.context
}

export function resolveRoleVariant(context, requested) {
  const role = context?.role || 'rider'
  if (role === 'driver') return 'driver'
  if (role === 'both') return requested === 'driver' ? 'driver' : 'rider'
  return 'rider'
}
