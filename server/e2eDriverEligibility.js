import { isE2ETestUser } from '../shared/e2eTestAccounts.js'

/** Like autoAssign, classify candidates by service-role profile email.
 * Real riders see only real drivers; E2E test riders see only E2E test drivers.
 * If profiles cannot be read, a test rider gets no drivers (fail closed), while a
 * real rider keeps the unfiltered list so a transient read error never blocks
 * real bookings.
 */
export async function eligibleDriverIdsForRider(sb, ids, riderIsE2E = false) {
  if (!ids.length) return []
  const e2eRider = riderIsE2E === true
  try {
    const result = await sb.from('profiles').select('id, email').in('id', ids)
    if (result.error) return e2eRider ? [] : ids
    const testIds = new Set((result.data || []).filter((profile) => isE2ETestUser(profile)).map((profile) => profile.id))
    return ids.filter((id) => testIds.has(id) === e2eRider)
  } catch {
    return e2eRider ? [] : ids
  }
}
