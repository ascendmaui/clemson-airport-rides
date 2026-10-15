import { supabase } from './supabase'

async function authHeaders() {
  const headers = { 'Content-Type': 'application/json' }
  if (!supabase) return headers
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function request(path, init = {}) {
  const res = await fetch(path, { ...init, headers: await authHeaders() })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const error = new Error(data.error || `HTTP ${res.status}`)
    error.status = res.status
    throw error
  }
  return data
}

export function fetchPayoutApprovalQueue() {
  return request('/api/driver?action=payout-approvals&scope=admin')
}

export function fetchMyPayoutRequests() {
  return request('/api/driver?action=payout-approvals')
}

export function decidePayoutRequest(id, decision, reason) {
  return request('/api/driver?action=payout-approvals', {
    method: 'POST',
    body: JSON.stringify({ id, decision, reason: reason || undefined }),
  })
}
