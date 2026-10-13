/**
 * Admin-only agreement email and driver signature.
 * Tests inject fetchImpl and a store so this never calls Resend by itself.
 */
import { createHash, randomBytes } from 'node:crypto'
import { WEB_ORIGIN } from '../shared/productLinks.js'
import {
  EMAIL_NOT_CONFIGURED,
  SIGN_LINK_TTL_MS,
  assessSignLink,
  emailSenderConfigured,
  signLinkMessage,
} from '../shared/agreementSign.js'
import { IC_AGREEMENT_VERSION } from '../shared/icAgreement.js'

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex')
}

export function newSignToken() {
  const token = randomBytes(32).toString('base64url')
  return { token, tokenHash: hashToken(token) }
}

export function signingUrl(token, origin = WEB_ORIGIN) {
  return `${String(origin).replace(/\/$/, '')}/#/sign-agreement?token=${encodeURIComponent(token)}`
}

export function supabaseAgreementStore(sb) {
  return {
    async revokeUnusedLinks(profileId, now) {
      const { error } = await sb.from('driver_agreement_sign_links')
        .update({ revoked_at: now })
        .eq('profile_id', profileId)
        .is('used_at', null)
        .is('revoked_at', null)
      if (error) throw new Error(error.message)
    },
    async insertLink(row) {
      const { data, error } = await sb.from('driver_agreement_sign_links').insert({
        token_hash: row.tokenHash,
        profile_id: row.profileId,
        agreement_version: row.version,
        packet_sha256: row.packetSha256,
        expires_at: row.expiresAt,
        created_by: row.adminId,
      }).select('id').maybeSingle()
      if (error) throw new Error(error.message)
      return { id: data?.id || null }
    },
    async insertSend(row) {
      const { error } = await sb.from('driver_agreement_sends').insert({
        profile_id: row.profileId,
        admin_id: row.adminId,
        to_address: row.to,
        result: row.result,
        agreement_version: row.version,
        packet_sha256: row.packetSha256,
        link_id: row.linkId,
        created_at: row.createdAt,
      })
      if (error) throw new Error(error.message)
    },
    async loadLinkByHash(tokenHash) {
      const { data, error } = await sb.from('driver_agreement_sign_links')
        .select('id, profile_id, agreement_version, packet_sha256, expires_at, used_at, revoked_at')
        .eq('token_hash', tokenHash)
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) return null
      return data
    },
    async loadPacket(profileId) {
      const { data, error } = await sb.from('driver_agreement_packets')
        .select('profile_id, agreement_version, prefill, html_snapshot, html_sha256')
        .eq('profile_id', profileId)
        .eq('agreement_version', IC_AGREEMENT_VERSION)
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) return null
      return {
        profileId: data.profile_id,
        version: data.agreement_version,
        prefill: data.prefill,
        html: data.html_snapshot,
        sha256: data.html_sha256,
      }
    },
    async markLinkUsed(id, now) {
      const { error } = await sb.from('driver_agreement_sign_links').update({ used_at: now }).eq('id', id)
      if (error) throw new Error(error.message)
    },
    async saveSignature(row) {
      const { error } = await sb.from('driver_agreements').upsert({
        profile_id: row.profileId,
        agreement_version: row.version,
        agreement_sha256: row.sha256,
        signature_name: row.signatureName,
        signed_at: row.signedAt,
        signer_user_id: row.profileId,
        html_snapshot: row.html,
        signed_ip: row.ip,
        signed_user_agent: row.userAgent,
        signature_accepted: true,
      }, { onConflict: 'profile_id,agreement_version' })
      if (error) throw new Error(error.message)
    },
  }
}

export async function sendAgreementForSignature({
  isAdmin,
  profileId,
  adminId,
  to,
  packet,
  env = process.env,
  now = new Date(),
  fetchImpl = globalThis.fetch,
  store,
  origin = WEB_ORIGIN,
  createToken = newSignToken,
}) {
  if (!isAdmin) {
    return { status: 403, body: { error: 'Admin only', emailed: false } }
  }
  if (!packet?.html || !packet?.sha256) {
    return { status: 400, body: { error: 'Agreement packet is missing', emailed: false } }
  }

  const { token, tokenHash } = createToken()
  const expiresAt = new Date(now.getTime() + SIGN_LINK_TTL_MS).toISOString()
  const createdAt = now.toISOString()
  await store.revokeUnusedLinks(profileId, createdAt)
  const link = await store.insertLink({
    tokenHash,
    profileId,
    version: packet.version || IC_AGREEMENT_VERSION,
    packetSha256: packet.sha256,
    expiresAt,
    adminId,
  })
  const url = signingUrl(token, origin)
  const configured = emailSenderConfigured(env)
  let result = 'not_configured'
  let emailed = false

  if (!to) {
    result = 'failed'
    await store.insertSend({
      profileId,
      adminId,
      to: null,
      result,
      version: packet.version || IC_AGREEMENT_VERSION,
      packetSha256: packet.sha256,
      linkId: link.id,
      createdAt,
    })
    return {
      status: 400,
      body: { emailed: false, error: 'Driver has no email', message: 'Driver has no email', signing_url: url },
    }
  }

  if (!configured) {
    await store.insertSend({
      profileId,
      adminId,
      to,
      result,
      version: packet.version || IC_AGREEMENT_VERSION,
      packetSha256: packet.sha256,
      linkId: link.id,
      createdAt,
    })
    return {
      status: 503,
      body: {
        emailed: false,
        copyable: true,
        error: EMAIL_NOT_CONFIGURED,
        message: EMAIL_NOT_CONFIGURED,
        signing_url: url,
      },
    }
  }

  try {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${String(env.RESEND_API_KEY).trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: String(env.RESEND_FROM).trim(),
        to: [to],
        subject: 'Sign your Clemson RIDES contractor agreement',
        text: [
          'An admin asked you to sign the Clemson RIDES independent contractor agreement.',
          'This link expires in 7 days and works once.',
          '',
          url,
        ].join('\n'),
      }),
    })
    const body = await res.json().catch(() => ({}))
    emailed = Boolean(res.ok)
    result = emailed ? 'emailed' : 'failed'
    if (!emailed) {
      await store.insertSend({
        profileId, adminId, to, result, version: packet.version || IC_AGREEMENT_VERSION,
        packetSha256: packet.sha256, linkId: link.id, createdAt,
      })
      return {
        status: 502,
        body: {
          emailed: false,
          error: body.message || body.error || 'email not sent',
          signing_url: url,
        },
      }
    }
  } catch (err) {
    await store.insertSend({
      profileId, adminId, to, result: 'failed', version: packet.version || IC_AGREEMENT_VERSION,
      packetSha256: packet.sha256, linkId: link.id, createdAt,
    })
    return {
      status: 502,
      body: { emailed: false, error: err.message || 'email not sent', signing_url: url },
    }
  }

  await store.insertSend({
    profileId, adminId, to, result, version: packet.version || IC_AGREEMENT_VERSION,
    packetSha256: packet.sha256, linkId: link.id, createdAt,
  })
  return { status: 200, body: { ok: true, emailed: true, signing_url: url, to } }
}

export async function previewSignLink({ viewerId, token, now = new Date(), store }) {
  const link = await store.loadLinkByHash(hashToken(token || ''))
  const verdict = assessSignLink({ link, viewerId, now: now.getTime() })
  if (!verdict.ok) return { status: 403, body: { error: signLinkMessage(verdict.reason) } }
  const packet = await store.loadPacket(link.profile_id)
  if (!packet || packet.sha256 !== link.packet_sha256) {
    return { status: 409, body: { error: 'Agreement changed. Ask an admin to send a new link.' } }
  }
  return {
    status: 200,
    body: {
      agreement_version: packet.version,
      html_snapshot: packet.html,
      html_sha256: packet.sha256,
      expires_at: link.expires_at,
    },
  }
}

export async function signFromLink({
  viewerId,
  token,
  signatureName,
  accepted,
  ip,
  userAgent,
  now = new Date(),
  store,
}) {
  const link = await store.loadLinkByHash(hashToken(token || ''))
  const verdict = assessSignLink({ link, viewerId, now: now.getTime() })
  if (!verdict.ok) return { status: 403, body: { error: signLinkMessage(verdict.reason) } }
  if (accepted !== true) return { status: 400, body: { error: 'Accept the agreement to sign' } }
  const name = String(signatureName || '').trim()
  if (name.length < 2) return { status: 400, body: { error: 'Type your legal name to sign' } }
  const packet = await store.loadPacket(link.profile_id)
  if (!packet || packet.sha256 !== link.packet_sha256 || packet.version !== IC_AGREEMENT_VERSION) {
    return { status: 409, body: { error: 'Agreement changed. Ask an admin to send a new link.' } }
  }
  const signedAt = now.toISOString()
  await store.saveSignature({
    profileId: viewerId,
    version: packet.version,
    sha256: packet.sha256,
    html: packet.html,
    signatureName: name,
    signedAt,
    ip: ip || null,
    userAgent: userAgent || null,
  })
  await store.markLinkUsed(link.id, signedAt)
  return {
    status: 200,
    body: {
      ok: true,
      agreement_version: packet.version,
      agreement_sha256: packet.sha256,
      signature_name: name,
      signed_at: signedAt,
      html_snapshot: packet.html,
    },
  }
}
