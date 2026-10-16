/** Partner self-serve sign-up rules (web form and /api/ads?action=signup). */
export const CREATIVE_MODES = ['upload', 'build']
export const UPLOAD_TYPES = {
  'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image', 'image/gif': 'image',
  'video/mp4': 'video', 'video/webm': 'video', 'video/quicktime': 'video',
}
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
export const FOUNDING_PACKAGE = 'founding-partner'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const URLISH = /^https:\/\/[^\s]+\.[^\s]{2,}$/i
const s = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)

export function normalizeSignup(b = {}) {
  return {
    businessName: s(b.businessName, 120),
    contactName: s(b.contactName, 120),
    email: s(b.email, 254).toLowerCase(),
    phone: s(b.phone, 32),
    category: s(b.category, 80),
    website: s(b.website, 300),
    packageId: s(b.packageId, 60) || FOUNDING_PACKAGE,
    creativeMode: CREATIVE_MODES.includes(b.creativeMode) ? b.creativeMode : '',
    storagePath: s(b.storagePath, 300),
    contentType: s(b.contentType, 60),
    headline: s(b.headline, 80),
    dealText: s(b.dealText, 160),
    qrUrl: s(b.qrUrl, 500),
    logoPath: s(b.logoPath, 300),
    theme: ['purple', 'orange', 'light'].includes(b.theme) ? b.theme : 'purple',
  }
}

export function signupErrors(b = {}) {
  const v = normalizeSignup(b)
  const e = {}
  if (v.businessName.length < 2) e.businessName = 'Enter your business name.'
  if (v.contactName.length < 2) e.contactName = 'Enter a contact name.'
  if (!EMAIL.test(v.email)) e.email = 'Enter a valid email.'
  const digits = v.phone.replace(/\D/g, '')
  if (digits.length < 10 || digits.length > 15) e.phone = 'Enter a phone number with area code.'
  if (!v.creativeMode) e.creativeMode = 'Upload your ad or choose Build my ad.'
  if (v.creativeMode === 'upload') {
    if (!v.storagePath || !/^pending\/[0-9a-f-]{36}\/[\w.-]{1,120}$/i.test(v.storagePath)) e.storagePath = 'Upload an image or video.'
    if (!UPLOAD_TYPES[v.contentType]) e.storagePath = 'Use a JPG, PNG, WebP, GIF, MP4, WebM or MOV file.'
  }
  if (v.creativeMode === 'build') {
    if (v.headline.length < 2) e.headline = 'Add a headline, usually your business name.'
    if (v.dealText.length < 3) e.dealText = 'Add the deal riders should see.'
  }
  if (v.qrUrl && !URLISH.test(v.qrUrl)) e.qrUrl = 'Use a full https:// link.'
  if (v.website && !/^https?:\/\//i.test(v.website)) e.website = 'Use a full https:// link.'
  return e
}

export function uploadPathFor(uuid, filename) {
  const clean = String(filename || 'ad').toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '').slice(-80) || 'ad'
  return `pending/${uuid}/${clean}`
}

export function uploadErrors({ contentType, size } = {}) {
  if (!UPLOAD_TYPES[contentType]) return 'Use a JPG, PNG, WebP, GIF, MP4, WebM or MOV file.'
  if (!(Number(size) > 0) || Number(size) > MAX_UPLOAD_BYTES) return 'Files must be under 50 MB.'
  return null
}
