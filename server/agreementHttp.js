/**
 * HTTP adapters for the pre-filled agreement. Admin send is the only email path.
 */
import { json, parseBody } from './friendRideLib.js'
import { IC_AGREEMENT_VERSION } from '../shared/icAgreement.js'
import { particularUpdates } from '../shared/agreementSign.js'
import { missingApplicantEmailColumn, submittedApplicantEmail } from '../shared/applicantEmail.js'
import { attachUnsignedPacket, applyParticularCorrections } from './agreementPacket.js'
import {
  previewSignLink,
  sendAgreementForSignature,
  signFromLink,
  supabaseAgreementStore,
} from './agreementMail.js'

export function requestClientIp(req) {
  const forwarded = req?.headers?.['x-forwarded-for'] || req?.headers?.['X-Forwarded-For']
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim().slice(0, 80)
  const addr = req?.socket?.remoteAddress
  return addr ? String(addr).slice(0, 80) : null
}

export async function handleEmailAgreement(sb, res, adminUser, body) {
  const profileId = String(body.profileId || body.profile_id || '').trim()
  if (!profileId) return json(res, 400, { error: 'profileId is required', emailed: false })

  let packet = null
  const existing = await sb.from('driver_agreement_packets')
    .select('agreement_version, prefill, html_snapshot, html_sha256')
    .eq('profile_id', profileId)
    .eq('agreement_version', IC_AGREEMENT_VERSION)
    .maybeSingle()
  if (!existing.error && existing.data?.html_snapshot) {
    packet = {
      version: existing.data.agreement_version,
      prefill: existing.data.prefill,
      html: existing.data.html_snapshot,
      sha256: existing.data.html_sha256,
    }
  } else {
    const attached = await attachUnsignedPacket(sb, profileId)
    if (attached.error) return json(res, 500, { error: attached.error, emailed: false })
    packet = attached.packet
  }

  const { data: profile, error } = await sb.from('profiles').select('email').eq('id', profileId).maybeSingle()
  if (error) return json(res, 500, { error: error.message, emailed: false })

  let storedEmail = ''
  const appRes = await sb.from('driver_applications').select('applicant_email').eq('profile_id', profileId).maybeSingle()
  if (appRes.error && !missingApplicantEmailColumn(appRes.error)) {
    return json(res, 500, { error: appRes.error.message, emailed: false })
  }
  if (!appRes.error) storedEmail = appRes.data?.applicant_email || ''
  const to = submittedApplicantEmail({ applicant_email: storedEmail }, { email: profile?.email }) || null

  const result = await sendAgreementForSignature({
    isAdmin: true,
    profileId,
    adminId: adminUser.id,
    to,
    packet,
    store: supabaseAgreementStore(sb),
  })
  return json(res, result.status, result.body)
}

export async function handleCorrectAgreement(sb, res, body) {
  const profileId = String(body.profileId || body.profile_id || '').trim()
  if (!profileId) return json(res, 400, { error: 'profileId is required' })
  const updates = particularUpdates(body)
  if (!Object.keys(updates).length) return json(res, 400, { error: 'No application fields to correct' })
  const corrected = await applyParticularCorrections(sb, profileId, updates)
  if (corrected.error) return json(res, 500, { error: corrected.error })
  return json(res, 200, {
    ok: true,
    emailed: false,
    prefill: corrected.packet.prefill,
    html_snapshot: corrected.packet.html,
    html_sha256: corrected.packet.sha256,
  })
}

export async function handleSignAgreement(req, res, sb, user) {
  const store = supabaseAgreementStore(sb)
  if (req.method === 'GET') {
    const url = new URL(req.url || '/', 'http://localhost')
    const preview = await previewSignLink({
      viewerId: user.id,
      token: url.searchParams.get('token') || '',
      store,
    })
    return json(res, preview.status, preview.body)
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  const { body, error } = parseBody(req)
  if (error) return json(res, 400, { error })
  const signed = await signFromLink({
    viewerId: user.id,
    token: body.token,
    signatureName: body.signatureName,
    accepted: body.accepted === true,
    ip: requestClientIp(req),
    userAgent: String(req.headers?.['user-agent'] || '').slice(0, 400) || null,
    store,
  })
  return json(res, signed.status, signed.body)
}
