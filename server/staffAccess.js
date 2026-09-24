import { isAdminIdentity, isSeedAdminEmail, normalizeEmail } from '../shared/adminAccess.js'

function envSupportEmails() {
  const raw = process.env.SUPPORT_ADMIN_EMAILS
  const source = raw == null || raw.trim() === ''
    ? 'johnmatveev@gmail.com,johnmatveyev@gmail.com,jmat2019@icloud.com,john@gmail.com'
    : raw
  return source.split(',').map((email) => normalizeEmail(email)).filter(Boolean)
}

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

  const admin = isAdminIdentity({
    jwtEmail,
    role: profile?.role,
    isAdmin: profile?.is_admin,
  }) || isSeedAdminEmail(profile?.email)

  let directoryRole = null
  if (sb && jwtEmail) {
    const row = await sb.from('admin_users').select('access_role').eq('email', jwtEmail).maybeSingle()
    if (!row.error) directoryRole = row.data?.access_role || null
  }

  const supportList = envSupportEmails()
  const support = admin
    || directoryRole === 'admin'
    || directoryRole === 'support'
    || supportList.includes(jwtEmail)

  return {
    admin: admin || directoryRole === 'admin',
    support,
    profile,
  }
}
