/** Test double for server/staffAccess.js. Does not read profiles or admin_users. */

export const state = {
  access: { admin: false, support: false, profile: null },
  calls: [],
}

export async function loadStaffAccess(_sb, user) {
  state.calls.push({ user })
  return state.access
}
