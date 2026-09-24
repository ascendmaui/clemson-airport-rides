import { normalizePromoCode } from '../packages/rides-native/authErrors.js'

/**
 * Exchange a verified Clerk identity for a Supabase magic-link hash.
 * The rider then calls verifyOtp, so PostgREST keeps using a Supabase JWT
 * and auth.uid() stays the auth.users UUID. A Clerk user id is not a UUID;
 * sending that JWT as the Supabase access token would make auth.uid() null.
 */

export function configuredSecret(name, value) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return false
  if (/placeholder|your_|changeme/i.test(trimmed)) return false
  if (name === 'CLERK_SECRET_KEY' && !/^sk_(test|live)_/.test(trimmed)) return false
  return true
}

export function missingBridgeEnv({ clerkSecret, serviceConfigured }) {
  const missing = []
  if (!configuredSecret('CLERK_SECRET_KEY', clerkSecret)) missing.push('CLERK_SECRET_KEY')
  if (!serviceConfigured) missing.push('SUPABASE_SERVICE_ROLE_KEY')
  return missing
}

export function bearerToken(req) {
  const header = req?.headers?.authorization || req?.headers?.Authorization || ''
  const match = String(header).match(/^Bearer\s+(\S+)/i)
  return match ? match[1].trim() : ''
}

export function verifiedEmailFromClerkUser(user) {
  const addresses = user?.emailAddresses || user?.email_addresses || []
  const primaryId = user?.primaryEmailAddressId || user?.primary_email_address_id
  const primary = addresses.find((row) => row.id === primaryId) || addresses[0]
  const email = String(primary?.emailAddress || primary?.email_address || '').trim().toLowerCase()
  const status = primary?.verification?.status || ''
  const first = user?.firstName || user?.first_name || ''
  const last = user?.lastName || user?.last_name || ''
  const fullName = [first, last].map((part) => String(part || '').trim()).filter(Boolean).join(' ')
  return {
    email,
    emailVerified: status === 'verified',
    fullName,
  }
}

function metadataPatch(user, identity, promoCode) {
  const meta = { ...(user?.user_metadata || {}) }
  meta.clerk_user_id = identity.clerkUserId
  if (identity.fullName && !meta.full_name) meta.full_name = identity.fullName
  const code = normalizePromoCode(promoCode)
  if (code && !meta.promo_code) meta.promo_code = code
  return meta
}

export async function bridgeClerkIdentity({ identity, promoCode, generateLink, updateUser }) {
  if (!identity?.email || !identity.emailVerified || !identity.clerkUserId) {
    return {
      status: 403,
      body: {
        error: 'Clerk did not return a verified email. Apple, Google, and Facebook must share a verified address before this account can book rides.',
      },
    }
  }

  let link
  try {
    link = await generateLink({ type: 'magiclink', email: identity.email })
  } catch (err) {
    return { status: 502, body: { error: err?.message || 'Could not open a Supabase session for this Clerk user.' } }
  }
  if (link?.error || !link?.data?.properties?.hashed_token || !link?.data?.user?.id) {
    return {
      status: 502,
      body: { error: link?.error?.message || 'Could not open a Supabase session for this Clerk user.' },
    }
  }

  const user = link.data.user
  try {
    await updateUser(user.id, { user_metadata: metadataPatch(user, identity, promoCode) })
  } catch (err) {
    console.warn('[clerk bridge] metadata', err?.message || err)
  }

  const verificationType = link.data.properties.verification_type === 'email' ? 'email' : 'magiclink'
  return {
    status: 200,
    body: {
      token_hash: link.data.properties.hashed_token,
      type: verificationType,
      email: identity.email,
    },
  }
}

export async function handleClerkSupabaseSession(req, deps) {
  if (req?.method !== 'POST') return { status: 405, body: { error: 'POST only' } }

  const missing = missingBridgeEnv(deps)
  if (missing.length) {
    return {
      status: 503,
      body: {
        error: 'Clerk to Supabase bridge is not configured. Email and password still sign in.',
        missing,
      },
    }
  }

  let body = req.body
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}')
    } catch {
      return { status: 400, body: { error: 'Invalid JSON' } }
    }
  }
  body = body || {}

  const token = bearerToken(req)
  if (!token) return { status: 401, body: { error: 'Missing Clerk session token' } }

  let payload
  try {
    payload = await deps.verifyClerk(token)
  } catch {
    return { status: 401, body: { error: 'Clerk session token was rejected' } }
  }
  const clerkUserId = String(payload?.sub || '')
  if (!clerkUserId) return { status: 401, body: { error: 'Clerk session token was rejected' } }

  let clerkUser
  try {
    clerkUser = await deps.loadClerkUser(clerkUserId)
  } catch {
    return { status: 401, body: { error: 'Clerk user could not be loaded' } }
  }

  const identity = verifiedEmailFromClerkUser(clerkUser)
  identity.clerkUserId = clerkUserId
  return bridgeClerkIdentity({
    identity,
    promoCode: body.promoCode,
    generateLink: deps.generateLink,
    updateUser: deps.updateUser,
  })
}
