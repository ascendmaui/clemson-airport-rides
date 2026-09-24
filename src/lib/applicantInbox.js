import { supabase } from './supabase'

async function authHeaders() {
  const headers = { 'Content-Type': 'application/json' }
  if (!supabase) return headers
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export async function loadApplicantInbox() {
  const headers = await authHeaders()
  const res = await fetch('/api/driver?action=inbox', { headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

export async function replyApplicantInbox(body) {
  const headers = await authHeaders()
  const res = await fetch('/api/driver?action=inbox', {
    method: 'POST',
    headers,
    body: JSON.stringify({ body }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}
