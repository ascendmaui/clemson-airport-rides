import { authedJson } from './apiClient.js'

/** Rider first name, photo and rating for an offer (POST /api/driver?action=offer-preview). */
export async function fetchOfferPreview(supabase, tripId) {
  if (!supabase || !tripId) return null
  try {
    const data = await authedJson(supabase, '/api/driver?action=offer-preview', { method: 'POST', body: { tripId } })
    return {
      firstName: typeof data?.riderFirstName === 'string' ? data.riderFirstName : null,
      avatarUrl: typeof data?.riderAvatarUrl === 'string' ? data.riderAvatarUrl : null,
      ratingAvg: data?.ratingAvg != null && Number.isFinite(Number(data.ratingAvg)) ? Number(data.ratingAvg) : null,
      ratingCount: Number(data?.ratingCount) || 0,
    }
  } catch {
    return null
  }
}

export function riderInitials(firstName) {
  const s = String(firstName || '').trim()
  return s ? s.slice(0, 1).toUpperCase() : 'R'
}
