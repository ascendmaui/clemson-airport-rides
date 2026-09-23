import { supabase } from './supabase'

export const CAMPUS_SPOTS = [
  // Neighborhoods / housing
  'White C',
  'Bigsby',
  'U on College',
  'Grand Mark',
  'The Pier',
  'The Reserve at Clemson',
  'Highpointe',
  'Campus View',
  'Clemson Lofts',
  '114 Earle',
  'The Enclave',
  'Hartwell Landing',
  'Patrick Square',
  'Downtown / College Ave',
  // Campus landmarks
  'Tillman Hall',
  'Memorial Stadium',
  'Cooper Library',
  'Schilletter',
  'Bowman Field',
  'Littlejohn',
  // Downtown bars
  "Tiger Town Tavern (Triple T's)",
  "TD's",
  'The Esso Club',
  'Backstreets',
  "Nick's Tavern",
  'Loose Change',
  '356',
  'Study Hall',
]

export const RIDE_STYLES = [
  { id: 'Quiet', emoji: 'shh' },
  { id: 'Chatty', emoji: 'chat' },
  { id: 'Music on', emoji: 'music' },
  { id: 'AC max', emoji: 'ac' },
]

export const PRIVACY_OPTIONS = [
  { id: 'public', label: 'Public', hint: 'Anyone signed in can see your vibe' },
  { id: 'matched', label: 'Matched rides', hint: 'Only trip counterparts' },
  { id: 'private', label: 'Private', hint: 'Name + rating only' },
]

export const GALLERY_KINDS = [
  { id: 'selfie', label: 'Selfie' },
  { id: 'car', label: 'Car', driversOnly: true },
  { id: 'campus', label: 'Campus' },
  { id: 'general', label: 'General' },
]

const PROFILE_COLS =
  'id, role, full_name, email, bio, avatar_url, student_verified_at, rating_avg, rating_count, phone, favorite_spots, music_taste, ride_style, profile_privacy, stripe_customer_id, stripe_default_pm_id, notification_prefs, billing_activated_at, stripe_card_brand, stripe_card_last4'

export function filterProfileByPrivacy(profile, { isOwner = false, isMatched = false } = {}) {
  if (!profile) return null
  if (isOwner) return { ...profile, _access: 'owner' }
  const privacy = profile.profile_privacy || 'matched'
  if (privacy === 'private' && !isMatched) {
    return {
      id: profile.id,
      full_name: profile.full_name,
      avatar_url: profile.avatar_url,
      rating_avg: profile.rating_avg,
      rating_count: profile.rating_count,
      role: profile.role,
      profile_privacy: privacy,
      _access: 'minimal',
    }
  }
  if (privacy === 'matched' && !isMatched) {
    return {
      id: profile.id,
      full_name: profile.full_name,
      avatar_url: profile.avatar_url,
      rating_avg: profile.rating_avg,
      rating_count: profile.rating_count,
      role: profile.role,
      bio: null,
      favorite_spots: [],
      music_taste: null,
      ride_style: null,
      profile_privacy: privacy,
      gallery: [],
      _access: 'matched_locked',
    }
  }
  return { ...profile, _access: privacy === 'public' ? 'public' : 'matched' }
}

export async function fetchFullProfile(userId, { viewerId = null, assumeMatched = false } = {}) {
  if (!supabase || !userId) return null
  let profile = null
  {
    const rich = await supabase
      .from('profiles')
      .select(PROFILE_COLS)
      .eq('id', userId)
      .maybeSingle()
    if (rich.error && /column|schema cache|notification_prefs|billing_activated|stripe_card_/i.test(rich.error.message || '')) {
      const basic = await supabase
        .from('profiles')
        .select('id, role, full_name, email, bio, avatar_url, student_verified_at, rating_avg, rating_count, phone, favorite_spots, music_taste, ride_style, profile_privacy, stripe_customer_id, stripe_default_pm_id')
        .eq('id', userId)
        .maybeSingle()
      if (basic.error) throw new Error(basic.error.message)
      profile = basic.data
    } else if (rich.error) {
      throw new Error(rich.error.message)
    } else {
      profile = rich.data
    }
  }
  if (!profile) return null

  const isOwner = viewerId && viewerId === userId
  let isMatched = Boolean(assumeMatched) || isOwner
  if (!isMatched && viewerId && supabase) {
    const { data: trips } = await supabase
      .from('trips')
      .select('id')
      .or(
        `and(rider_id.eq.${viewerId},driver_id.eq.${userId}),and(driver_id.eq.${viewerId},rider_id.eq.${userId})`,
      )
      .limit(1)
    isMatched = Boolean(trips?.length)
  }

  let vehicle = null
  if (profile.role === 'driver' || profile.role === 'both') {
    const { data: veh } = await supabase
      .from('vehicles')
      .select('make, model, color, plate, seats, is_tesla, tier')
      .eq('driver_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    vehicle = veh
  }

  const { data: recent } = await supabase
    .from('ratings')
    .select('stars, comment, created_at')
    .eq('ratee_id', userId)
    .order('created_at', { ascending: false })
    .limit(8)

  let gallery = []
  const { data: gal } = await supabase
    .from('profile_gallery')
    .select('id, storage_path, public_url, caption, kind, visibility, sort_order')
    .eq('profile_id', userId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
  gallery = gal || []

  const full = {
    ...profile,
    favorite_spots: profile.favorite_spots || [],
    vehicle,
    recentRatings: recent || [],
    gallery,
  }
  return filterProfileByPrivacy(full, { isOwner, isMatched })
}

export async function uploadAvatar(userId, file) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!file) throw new Error('No file')
  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${userId}/avatar-${Date.now()}.${ext}`
  const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, {
    upsert: true,
    contentType: file.type || 'image/jpeg',
  })
  if (upErr) throw new Error(upErr.message)
  const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
  const url = pub?.publicUrl
  const { error } = await supabase
    .from('profiles')
    .update({ avatar_url: url, updated_at: new Date().toISOString() })
    .eq('id', userId)
  if (error) throw new Error(error.message)
  return url
}

export async function uploadGalleryItem(userId, file, { kind = 'general', caption = '', visibility = 'matched' } = {}) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!file) throw new Error('No file')
  const ext = (file.name?.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${userId}/${kind}-${Date.now()}.${ext}`
  const { error: upErr } = await supabase.storage.from('gallery').upload(path, file, {
    upsert: false,
    contentType: file.type || 'image/jpeg',
  })
  if (upErr) throw new Error(upErr.message)
  const { data: pub } = supabase.storage.from('gallery').getPublicUrl(path)
  const publicUrl = pub?.publicUrl || null
  const { data, error } = await supabase
    .from('profile_gallery')
    .insert({
      profile_id: userId,
      storage_path: path,
      public_url: publicUrl,
      caption: caption || null,
      kind,
      visibility,
      sort_order: 0,
    })
    .select('id, storage_path, public_url, caption, kind, visibility, sort_order')
    .single()
  if (error) throw new Error(error.message)
  return data
}

export async function deleteGalleryItem(userId, item) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (item?.storage_path) {
    await supabase.storage.from('gallery').remove([item.storage_path])
  }
  const { error } = await supabase
    .from('profile_gallery')
    .delete()
    .eq('id', item.id)
    .eq('profile_id', userId)
  if (error) throw new Error(error.message)
}

export async function updateGalleryVisibility(userId, itemId, visibility) {
  if (!supabase) throw new Error('Supabase is not configured')
  const { error } = await supabase
    .from('profile_gallery')
    .update({ visibility })
    .eq('id', itemId)
    .eq('profile_id', userId)
  if (error) throw new Error(error.message)
}
