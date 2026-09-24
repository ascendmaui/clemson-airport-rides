import { studentDiscountGranted } from '../src/lib/studentDomain.js'

/**
 * Per-rider Standard discount for a friend ride.
 * Uses the auth user email from the service role. The address typed on join
 * and a stored student timestamp do not qualify.
 */
export async function studentFlagsFor(sb, participants) {
  const flags = []
  for (const participant of participants) {
    if (!participant?.user_id || !sb?.auth?.admin?.getUserById) {
      flags.push(false)
      continue
    }
    try {
      const { data, error } = await sb.auth.admin.getUserById(participant.user_id)
      flags.push(!error && studentDiscountGranted(data?.user))
    } catch {
      flags.push(false)
    }
  }
  return flags
}
