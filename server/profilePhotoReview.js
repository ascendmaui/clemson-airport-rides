/**
 * Server-side driver profile photo review.
 * Compares the upload with the license image already on file through the
 * AI Gateway vision model. A clear single-face match is approved.
 * Anything else, including a model error, waits for an admin.
 * Rejection is admin-only.
 */
import { generateText } from 'ai'
import { resolveVisionModel } from './llm.js'
import {
  adminFallbackEnabled,
  driverProfilePhotoMessage,
  profilePhotoStoragePath,
  verdictFromSignals,
} from '../shared/profilePhotoReview.js'

const VISION_PROMPT = [
  'You compare two images for a rideshare driver profile photo.',
  'Image 1 is the new profile photo. Image 2 is the driver license already on file.',
  'Reply with JSON only, no markdown:',
  '{"clear":boolean,"blurry":boolean,"dark":boolean,"faceCount":number,"matchesLicense":boolean,"confidence":number,"reason":string}',
  'clear is true only when image 1 is not blurry and not dark.',
  'faceCount is how many human faces are in image 1.',
  'matchesLicense is true only when image 1 shows the same person as the face on the license.',
  'confidence is a number from 0 to 1.',
  'reason is one short sentence about image 1.',
  'Do not approve or reject. Report only what you see.',
].join(' ')

function clip(value, max = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

export function safeReviewError(err) {
  const message = String(err?.message || err || 'AI review failed')
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/AI_GATEWAY_API_KEY[=:]\S+/gi, '[redacted]')
  return clip(`AI review failed. ${message}`)
}

export function parseVisionJson(text) {
  const raw = String(text || '').trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Vision review did not return JSON')
  const parsed = JSON.parse(body.slice(start, end + 1))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Vision review did not return JSON')
  }
  return parsed
}

export function mimeFromPath(storagePath) {
  const ext = String(storagePath || '').split('.').pop()?.toLowerCase() || ''
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'heic' || ext === 'heif') return 'image/heic'
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  return 'application/octet-stream'
}

async function bytesFromStorage(sb, storagePath) {
  const file = await sb.storage.from('driver-documents').download(storagePath)
  if (file?.error) throw new Error(file.error.message || 'Could not read the stored photo')
  const data = file?.data
  if (!data) throw new Error('Could not read the stored photo')
  if (typeof data.arrayBuffer === 'function') return new Uint8Array(await data.arrayBuffer())
  if (data instanceof Uint8Array) return data
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) return new Uint8Array(data)
  throw new Error('Could not read the stored photo')
}

async function licenseOnFile(sb, userId) {
  for (const docType of ['license_front', 'license_back']) {
    const row = await sb.from('driver_documents')
      .select('storage_path, doc_type')
      .eq('profile_id', userId)
      .eq('doc_type', docType)
      .maybeSingle()
    if (row?.error) throw new Error(row.error.message || 'Could not load the license')
    const path = row?.data?.storage_path
    if (path && String(path).startsWith(`${userId}/`)) return row.data
  }
  return null
}

export async function defaultVision(input, deps = {}) {
  const resolve = deps.resolveVisionModel || resolveVisionModel
  const gen = deps.generateText || generateText
  const resolved = resolve()
  if (!resolved) return { unavailable: true }
  const result = await gen({
    model: resolved.model,
    temperature: 0,
    maxOutputTokens: 400,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: VISION_PROMPT },
        { type: 'image', image: input.photo.bytes, mediaType: input.photo.mime },
        { type: 'image', image: input.license.bytes, mediaType: input.license.mime },
      ],
    }],
  })
  return parseVisionJson(result?.text || '')
}

async function loadSignals({ sb, userId, storagePath, vision }) {
  try {
    const license = await licenseOnFile(sb, userId)
    if (!license) {
      return { missingLicense: true, reason: 'No driver license image is on file.' }
    }
    const photoMime = mimeFromPath(storagePath)
    const licenseMime = mimeFromPath(license.storage_path)
    if (!photoMime.startsWith('image/') || !licenseMime.startsWith('image/')) {
      return {
        clear: false,
        blurry: false,
        dark: false,
        faceCount: 0,
        matchesLicense: false,
        confidence: null,
        reason: 'The profile photo and the license on file both need to be images.',
      }
    }
    const photoBytes = await bytesFromStorage(sb, storagePath)
    if (photoBytes.length < 12_000) {
      return {
        clear: false,
        blurry: true,
        dark: false,
        faceCount: 0,
        matchesLicense: false,
        confidence: 0.2,
        reason: 'The profile photo is too small or looks blank.',
      }
    }
    if (photoBytes.length > 8 * 1024 * 1024) {
      return {
        clear: false,
        blurry: false,
        dark: false,
        faceCount: 0,
        matchesLicense: false,
        confidence: null,
        reason: 'The profile photo is too large to review automatically.',
      }
    }
    const licenseBytes = await bytesFromStorage(sb, license.storage_path)
    const seen = await vision({
      photo: { bytes: photoBytes, mime: photoMime },
      license: { bytes: licenseBytes, mime: licenseMime },
    })
    if (seen?.unavailable) {
      return { unavailable: true, reason: 'Vision review is not configured. Sent to admin review.' }
    }
    return seen || { error: true, reason: 'AI review failed.' }
  } catch (err) {
    return { error: true, reason: safeReviewError(err) }
  }
}

function missingTable(error) {
  return /schema cache|does not exist|driver_profile_photos|ai_verdict|ai_confidence|ai_reason/i.test(error?.message || '')
}

async function driverName(sb, userId) {
  try {
    const profile = await sb.from('profiles').select('full_name').eq('id', userId).maybeSingle()
    return clip(profile?.data?.full_name, 80)
  } catch {
    return ''
  }
}

async function notifyAdmin(sb, { photoId, userId, reason }) {
  const name = await driverName(sb, userId)
  const body = clip(name ? `${name}: ${reason}` : reason)
  const inserted = await sb.from('admin_notifications').insert({
    kind: 'other',
    title: 'Profile photo needs a look',
    body: body || 'A driver profile photo needs a look.',
    entity_type: 'driver_profile_photo',
    entity_id: String(photoId),
  }).select('id').maybeSingle()
  return !inserted?.error && Boolean(inserted?.data)
}

export async function reviewUploadedProfilePhoto({
  sb,
  userId,
  storagePath,
  vision,
  env = process.env,
}) {
  const path = profilePhotoStoragePath(userId, storagePath)
  if (!path) {
    return { status: 400, error: 'Upload the photo to your profile photo folder first.' }
  }
  const inspect = vision || ((input) => defaultVision(input))
  const signals = await loadSignals({ sb, userId, storagePath: path, vision: inspect })
  const verdict = verdictFromSignals(signals, { fallbackEnabled: adminFallbackEnabled(env) })
  if (verdict.reviewStatus === 'rejected') {
    verdict.reviewStatus = 'pending_admin_review'
    verdict.notifyAdmin = true
  }
  const row = {
    profile_id: userId,
    storage_path: path,
    review_status: verdict.reviewStatus,
    ai_verdict: verdict.aiVerdict,
    ai_confidence: verdict.aiConfidence,
    ai_reason: verdict.aiReason,
    reviewed_at: verdict.reviewStatus === 'approved' ? new Date().toISOString() : null,
    reviewed_by: null,
    created_at: new Date().toISOString(),
  }
  const inserted = await sb.from('driver_profile_photos')
    .insert(row)
    .select('id, review_status, ai_verdict, ai_confidence, ai_reason')
    .maybeSingle()
  if (inserted?.error) {
    if (missingTable(inserted.error)) {
      return {
        status: 503,
        error: 'Apply supabase/migrations/20261013180000_driver_profile_photo_ai_review.sql',
      }
    }
    return { status: 500, error: 'Could not save the profile photo review.' }
  }
  const photoId = inserted?.data?.id
  if (!photoId) return { status: 500, error: 'Could not save the profile photo review.' }
  let notified = false
  if (verdict.notifyAdmin) {
    try {
      notified = await notifyAdmin(sb, { photoId, userId, reason: verdict.aiReason })
    } catch (err) {
      console.error('[profile-photo] notify', safeReviewError(err))
    }
  }
  return {
    status: 200,
    ok: true,
    photoId,
    reviewStatus: verdict.reviewStatus,
    aiVerdict: verdict.aiVerdict,
    aiConfidence: verdict.aiConfidence,
    aiReason: verdict.aiReason,
    driverMessage: verdict.driverMessage,
    notified,
  }
}

export async function latestProfilePhoto(sb, userId) {
  const row = await sb.from('driver_profile_photos')
    .select('id, review_status, ai_verdict, created_at')
    .eq('profile_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (row?.error) {
    if (missingTable(row.error)) return { status: 200, photo: null, migrationRequired: true }
    return { status: 500, error: 'Could not load the profile photo.' }
  }
  if (!row?.data) return { status: 200, photo: null }
  return {
    status: 200,
    photo: {
      id: row.data.id,
      reviewStatus: row.data.review_status,
      driverMessage: driverProfilePhotoMessage(row.data.review_status),
    },
  }
}
