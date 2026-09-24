import { createClerkClient, verifyToken } from '@clerk/backend'
import { cors, json } from '../server/friendRideLib.js'
import { adminClient } from '../server/supabaseAdmin.js'
import { handleClerkSupabaseSession } from '../server/clerkSupabaseBridge.js'

export default async function handler(req, res) {
  if (cors(req, res)) return
  const secret = process.env.CLERK_SECRET_KEY || ''
  const sb = adminClient()
  const result = await handleClerkSupabaseSession(req, {
    clerkSecret: secret,
    serviceConfigured: Boolean(sb),
    verifyClerk: (token) => verifyToken(token, { secretKey: secret }),
    loadClerkUser: async (userId) => {
      const clerk = createClerkClient({ secretKey: secret })
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
