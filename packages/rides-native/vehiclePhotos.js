/**
 * Multiple vehicle photos for a driver.
 * Objects live in the existing private driver-documents bucket.
 * Required angle shots stay on driver_documents. Extra shots are rows here.
 */

export const VEHICLE_PHOTO_KINDS = [
  { id: 'exterior', label: 'Exterior', hint: 'Outside of the car' },
  { id: 'interior', label: 'Interior', hint: 'Seats, dashboard, or cargo area' },
  { id: 'other', label: 'Other', hint: 'Wheels, trunk, or another view' },
]

export const MAX_VEHICLE_PHOTOS = 12
export const VEHICLE_PHOTO_MAX_BYTES = 8 * 1024 * 1024
export const VEHICLE_PHOTO_BUCKET = 'driver-documents'

const TABLE = 'driver_vehicle_photos'
const SIGNED_URL_SECONDS = 60 * 30

const ANGLE_DOCS = [
  { id: 'car_front', label: 'Front' },
  { id: 'car_back', label: 'Back' },
  { id: 'car_left', label: 'Left side' },
  { id: 'car_right', label: 'Right side' },
]

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

const KIND_LABELS = {
  exterior: 'Exterior',
  interior: 'Interior',
  other: 'Other',
}

export function isVehiclePhotoKind(kind) {
  return Object.prototype.hasOwnProperty.call(KIND_LABELS, kind)
}

export function vehiclePhotoKindLabel(kind) {
  if (!isVehiclePhotoKind(kind)) return 'Photo'
  return KIND_LABELS[kind]
}

function missingPhotoTable(error) {
  return /driver_vehicle_photos|schema cache|relation/i.test(error?.message || '')
}

function mimeOf(file) {
  return String(file?.mimeType || file?.type || '').toLowerCase()
}

function sizeOf(file) {
  if (typeof file?.size === 'number') return file.size
  if (typeof file?.fileSize === 'number') return file.fileSize
  return 0
}

function extOf(file) {
  const name = String(file?.name || '')
  const fromName = name.includes('.') ? name.split('.').pop() : ''
  const cleaned = String(fromName || '').toLowerCase().replace(/[^a-z0-9]/g, '')
  if (cleaned && cleaned.length <= 5 && cleaned !== 'jpeg') return cleaned === 'jpg' ? 'jpg' : cleaned
  const mime = mimeOf(file)
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/heic' || mime === 'image/heif') return 'heic'
  return 'jpg'
}

function assertUserId(userId) {
  if (!userId || typeof userId !== 'string' || userId.includes('/') || userId.includes('..')) {
    throw new Error('Sign in required')
  }
}

export function assertVehiclePhotoFile(file) {
  if (!file || (!file.uri && typeof file.arrayBuffer !== 'function')) {
    throw new Error('Choose a photo')
  }
  const mime = mimeOf(file)
  if (mime && !ALLOWED_MIME.has(mime)) {
    throw new Error('Upload a JPEG, PNG, WebP, or HEIC photo.')
  }
  if (sizeOf(file) > VEHICLE_PHOTO_MAX_BYTES) {
    throw new Error('Each photo must be 8MB or smaller')
  }
}

async function fileBytes(file) {
  if (file.uri) {
    const response = await fetch(file.uri)
    if (!response.ok && response.status) {
      throw new Error('Could not read that photo')
    }
    return response.arrayBuffer()
  }
  return file.arrayBuffer()
}

async function signedPhotoUrl(supabase, storagePath) {
  if (!storagePath) return null
  const signed = await supabase.storage.from(VEHICLE_PHOTO_BUCKET).createSignedUrl(storagePath, SIGNED_URL_SECONDS)
  return signed.data?.signedUrl || null
}

function extraRow(row, url) {
  return {
    id: row.id,
    profile_id: row.profile_id,
    storage_path: row.storage_path,
    kind: row.kind,
    label: vehiclePhotoKindLabel(row.kind),
    url,
    created_at: row.created_at || null,
    source: 'extra',
  }
}

export async function listVehiclePhotos(supabase, userId) {
  if (!supabase || !userId) return []
  const { data, error } = await supabase
    .from(TABLE)
    .select('id, profile_id, storage_path, kind, created_at')
    .eq('profile_id', userId)
    .order('created_at', { ascending: true })
  if (error) {
    if (missingPhotoTable(error)) return []
    throw new Error(error.message)
  }
  const photos = []
  for (const row of data || []) {
    photos.push(extraRow(row, await signedPhotoUrl(supabase, row.storage_path)))
  }
  return photos
}

export async function listAnglePhotos(supabase, userId) {
  if (!supabase || !userId) return []
  const { data, error } = await supabase
    .from('driver_documents')
    .select('id, doc_type, storage_path, created_at')
    .eq('profile_id', userId)
  if (error) throw new Error(error.message)
  const byType = new Map((data || []).map((row) => [row.doc_type, row]))
  const photos = []
  for (const angle of ANGLE_DOCS) {
    const row = byType.get(angle.id)
    if (!row) continue
    photos.push({
      id: row.id,
      profile_id: userId,
      storage_path: row.storage_path,
      kind: 'exterior',
      label: angle.label,
      url: await signedPhotoUrl(supabase, row.storage_path),
      created_at: row.created_at || null,
      source: 'angle',
    })
  }
  return photos
}

export async function listProfileVehiclePhotos(supabase, userId) {
  const [angles, extras] = await Promise.all([
    listAnglePhotos(supabase, userId),
    listVehiclePhotos(supabase, userId),
  ])
  return [...angles, ...extras]
}

export async function uploadVehiclePhoto(supabase, userId, kind, file) {
  if (!supabase) throw new Error('Supabase is not configured')
  assertUserId(userId)
  if (!isVehiclePhotoKind(kind)) throw new Error('Choose exterior, interior, or other.')
  assertVehiclePhotoFile(file)

  const existing = await supabase.from(TABLE).select('id').eq('profile_id', userId)
  if (existing.error) {
    if (missingPhotoTable(existing.error)) throw new Error('Vehicle photos are not available yet.')
    throw new Error(existing.error.message)
  }
  if ((existing.data || []).length >= MAX_VEHICLE_PHOTOS) {
    throw new Error(`You can add up to ${MAX_VEHICLE_PHOTOS} vehicle photos.`)
  }

  const path = `${userId}/vehicle_photos/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extOf(file)}`
  const bytes = await fileBytes(file)
  const uploaded = await supabase.storage.from(VEHICLE_PHOTO_BUCKET).upload(path, bytes, {
    contentType: mimeOf(file) || 'image/jpeg',
    upsert: false,
  })
  if (uploaded.error) throw new Error(uploaded.error.message)

  const inserted = await supabase
    .from(TABLE)
    .insert({
      profile_id: userId,
      storage_path: path,
      kind,
    })
    .select('id, profile_id, storage_path, kind, created_at')
    .single()
  if (inserted.error) {
    await supabase.storage.from(VEHICLE_PHOTO_BUCKET).remove([path])
    throw new Error(inserted.error.message)
  }
  return extraRow(inserted.data, await signedPhotoUrl(supabase, path))
}

export async function removeVehiclePhoto(supabase, userId, photo) {
  if (!supabase) throw new Error('Supabase is not configured')
  assertUserId(userId)
  const id = photo?.id
  if (!id || photo?.source === 'angle') throw new Error('Photo not found')
  const { error } = await supabase.from(TABLE).delete().eq('id', id).eq('profile_id', userId)
  if (error) throw new Error(error.message)
  if (photo.storage_path) {
    await supabase.storage.from(VEHICLE_PHOTO_BUCKET).remove([photo.storage_path])
  }
}
