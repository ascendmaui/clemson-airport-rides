import { normalizeEmail } from '../shared/adminAccess.js'
import { isDeniedAdminEmail, serverIsAdmin, supportInboxEmails } from './adminRoster.js'

export async function loadStaffAccess(sb, user) {
  const jwtEmail = normalizeEmail(user?.email)
  let profile = null
  if (sb && user?.id) {
    const rich = await sb
      .from('profiles')
      .select('id, email, full_name, role, is_admin')
      .eq('id', user.id)
      .maybeSingle()
    if (rich.error && /column|schema cache|is_admin/i.test(rich.error.message || '')) {
      const basic = await sb.from('profiles').select('id, email, full_name, role').eq('id', user.id).maybeSingle()
      profile = basic.data || null
    } else if (!rich.error) {
      profile = rich.data || null
    }
  }

  const denied = isDeniedAdminEmail(jwtEmail) || isDeniedAdminEmail(profile?.email)

  let directoryRole = null
  if (sb && jwtEmail) {
    const row = await sb.from('admin_users').select('access_role').eq('email', jwtEmail).maybeSingle()
    if (!row.error) directoryRole = row.data?.access_role || null
  }

  const supportList = supportInboxEmails()
  const rosterAdmin = serverIsAdmin({
    jwtEmail,
    profileEmail: profile?.email,
    role: profile?.role,
    isAdmin: profile?.is_admin,
  })
  const admin = !denied && (rosterAdmin || directoryRole === 'admin')
  const support = !denied && (
    admin
    || directoryRole === 'support'
    || supportList.includes(jwtEmail)
  )

  return {
    admin,
    support,
    profile,
  }
}
