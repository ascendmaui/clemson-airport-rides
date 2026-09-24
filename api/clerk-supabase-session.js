import { createClerkClient, verifyToken } from '@clerk/backend'
import { cors, json } from '../server/friendRideLib.js'
import { adminClient } from '../server/supabaseAdmin.js'
import { clerkSecrets, handleClerkSupabaseSession, verifyWithAnySecret } from '../server/clerkSupabaseBridge.js'

export default async function handler(req, res) {
  if (cors(req, res)) return
  const secrets = clerkSecrets(process.env)
  // Secret of the Clerk instance that signed this request's token (dev or prod).
  let matched = secrets[0] || ''
  const sb = adminClient()
  const result = await handleClerkSupabaseSession(req, {
    clerkSecret: secrets[0] || '',
    serviceConfigured: Boolean(sb),
    verifyClerk: async (token) => {
      const { payload, secret } = await verifyWithAnySecret(token, secrets, (t, secretKey) => verifyToken(t, { secretKey }))
      matched = secret
      return payload
    },
    loadClerkUser: async (userId) => {
      const clerk = createClerkClient({ secretKey: matched })
      return clerk.users.getUser(userId)
    },
    generateLink: (params) => {
      if (!sb) throw new Error('Supabase is not configured')
      return sb.auth.admin.generateLink(params)
    },
    updateUser: (id, patch) => {
      if (!sb) throw new Error('Supabase is not configured')
      return sb.auth.admin.updateUserById(id, patch)
    },
  })
  json(res, result.status, result.body)
}
