import { authedJson } from './apiClient.js'

/** Same Stripe tip route as the web app. Vite and Vercel both map this to /api/driver?action=tip. */
export function submitTripTip(supabase, body) {
  return authedJson(supabase, '/api/trip-tip', { method: 'POST', body })
}
