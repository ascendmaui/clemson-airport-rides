import { apiBase } from 'rides-native/apiClient'

type BridgeResponse = {
  token_hash?: string
  type?: string
  error?: string
  missing?: string[]
}

/**
 * Turn a Clerk session into a Supabase session.
 * The Clerk JWT is only a bearer for this request. The app then stores the
 * Supabase session, so RLS auth.uid() stays the auth.users UUID.
 */
export async function exchangeClerkSession(
  supabase: { auth: { verifyOtp: (args: { token_hash: string; type: 'magiclink' | 'email' }) => Promise<{ error: { message?: string } | null }> } },
  { token, promoCode }: { token: string; promoCode?: string },
) {
  let response: Response
  try {
    response = await fetch(`${apiBase()}/api/clerk-supabase-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(promoCode ? { promoCode } : {}),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error'
    throw new Error(message)
  }

  const text = await response.text()
  let body: BridgeResponse = {}
  try {
    body = text ? JSON.parse(text) as BridgeResponse : {}
  } catch {
    throw new Error('Clerk bridge is unavailable')
  }
  if (!response.ok) {
    const missing = Array.isArray(body.missing) && body.missing.length
      ? ` Missing: ${body.missing.join(', ')}.`
      : ''
    throw new Error(`${body.error || 'Could not open a Supabase session'}${missing}`)
  }
  if (!body.token_hash) throw new Error('Could not open a Supabase session')
  const type = body.type === 'email' ? 'email' : 'magiclink'
  const { error } = await supabase.auth.verifyOtp({ token_hash: body.token_hash, type })
  if (error) throw new Error(error.message || 'Could not open a Supabase session')
}
