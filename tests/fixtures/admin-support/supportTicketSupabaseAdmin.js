/** Test double for server/supabaseAdmin.js. No Supabase client and no network. */

export const state = {
  client: null,
  user: null,
  authCalls: 0,
}

export function adminClient() {
  return state.client
}

export async function userFromAuth() {
  state.authCalls += 1
  return state.user
}
