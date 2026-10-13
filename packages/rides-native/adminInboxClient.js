import { authedJson } from './apiClient.js'
import { WEB_ADMIN_URL, inboxActionRequest } from '../../shared/adminInbox.js'

export { WEB_ADMIN_URL, inboxActionRequest }

export async function loadAdminInbox(supabase, fetchImpl) {
  try {
    const data = await authedJson(supabase, '/api/admin?action=inbox', { fetch: fetchImpl })
    return {
      admin: true,
      total: 0,
      counts: {},
      items: [],
      ...data,
    }
  } catch (err) {
    if (err?.status === 401 || err?.status === 403) {
      return { admin: false, total: 0, counts: {}, items: [] }
    }
    throw err
  }
}

export async function runAdminInboxAction(supabase, action, { reason, fetch: fetchImpl } = {}) {
  const request = inboxActionRequest(action, { reason })
  if (request.error) {
    const error = new Error(request.error)
    error.status = 400
    throw error
  }
  if (request.method === 'GET') return request
  return authedJson(supabase, request.path, {
    method: request.method,
    body: request.body,
    fetch: fetchImpl,
  })
}
