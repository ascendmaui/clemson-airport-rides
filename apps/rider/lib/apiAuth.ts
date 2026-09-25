import { supabase } from '@/lib/supabase'

export function apiBase() {
  return (process.env.EXPO_PUBLIC_API_BASE || 'https://clemson-airport-rides.vercel.app').replace(/\/$/, '')
}

export function apiUrl(path: string) {
  return `${apiBase()}${path.startsWith('/') ? path : `/${path}`}`
}

export async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/plain' }
  if (!supabase) return headers
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export { authedJson } from 'rides-native/apiClient.js'

