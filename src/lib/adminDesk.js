import { supabase } from './supabase'

async function authHeaders() {
  const headers = { 'Content-Type': 'application/json' }
  if (!supabase) return headers
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export async function adminRequest(action, { method = 'GET', body, query = {} } = {}) {
  const headers = await authHeaders()
  const params = new URLSearchParams({ action, ...query })
  const res = await fetch(`/api/admin?${params}`, {
    method,
    headers,
    body: method === 'GET' ? undefined : JSON.stringify(body || {}),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const error = new Error(data.error || `HTTP ${res.status}`)
    error.status = res.status
    error.payload = data
    throw error
  }
  return data
}

export function fetchAdminOverview() {
  return adminRequest('overview')
}

export function fetchAdminNotifications() {
  return adminRequest('notifications')
}

export function markAdminNotifications({ id, all = false } = {}) {
  return adminRequest('mark-notification', { method: 'POST', body: all ? { all: true } : { id } })
}

export function fetchAdminPeople(role) {
  return adminRequest('people', { query: role ? { role } : {} })
}

export function fetchAdminTrips(status) {
  return adminRequest('trips', { query: status ? { status } : {} })
}

export function fetchAdminTickets(status) {
  return adminRequest('tickets', { query: status ? { status } : {} })
}

export function fetchAdminTicket(id) {
  return adminRequest('tickets', { query: { id } })
}

export function replyAdminTicket({ ticketId, body, status }) {
  return adminRequest('ticket-reply', { method: 'POST', body: { ticketId, body, status } })
}

export function fetchApplicantThread(profileId) {
  return adminRequest('applicant-thread', { query: { profile_id: profileId } })
}

export function messageApplicant({ profileId, body }) {
  return adminRequest('applicant-message', { method: 'POST', body: { profileId, body } })
}

export function requestApplicantInfo({ profileId, prompt }) {
  return adminRequest('info-request', { method: 'POST', body: { profileId, prompt } })
}
