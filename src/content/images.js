/**
 * Single photo config for the marketing site.
 * Alt text and named-to-no-name fallbacks come from public/images/manifest.json.
 *
 * USE_BRANDED_PHOTOS defaults on for staging. Set VITE_USE_BRANDED_PHOTOS=false
 * to use the no-name twins. A photo with no twin is hidden.
 * The old street unbranded file is not a fallback. It does not match this hero.
 */
import imageManifest from '../../public/images/manifest.json' with { type: 'json' }

const WIDTHS = [480, 768, 1280]
const SIZES = '(min-width: 960px) 340px, 62vw'

export const HERO_COLLAGE = [
  { id: 'students-carpool-street', className: 'mkt-hero-shot mkt-hero-shot--lead', eager: true },
  { id: 'students-stadium-request', className: 'mkt-hero-shot mkt-hero-shot--request', eager: false },
  { id: 'airport-on-time', className: 'mkt-hero-shot mkt-hero-shot--backseat', eager: false },
]

export const NIGHT_VENUES = [
  'studyhall-corner-night',
  'roar-corner-night',
  'keller-building-night',
  'mural-bar-long-line-night',
  'college-ave-tds-loose-change-ttt',
  'college-ave-csp-356-walkons',
]

export const FEATURE_IMAGES = {
  student: 'library-study-group',
  gameday: 'gameday-crowd',
  matching: 'college-ave-request',
  tracking: 'campus-phone',
}

const EXTRA_UNBRANDED = {
  '/images/hero/students-stadium-request.jpg': '/images/unbranded/students-stadium-request.jpg',
  '/images/hero/students-carpool-backseat.jpg': '/images/unbranded/students-carpool-backseat.jpg',
}

const EXTRA_IMAGES = [
  {
    src: '/images/hero/students-carpool-backseat.jpg',
    alt: 'Three friends in the back seat of a car at night, heading out together',
  },
  { src: '/images/lifestyle/night-live-tracking.jpg', alt: 'A phone showing a live ride on a map during a night out' },
  { src: '/images/lifestyle/night-sos.jpg', alt: 'A student using the in-app SOS control at night' },
  { src: '/images/lifestyle/safety-recording.jpg', alt: 'A phone on a car console with a microphone button ready to record audio' },
  { src: '/images/lifestyle/safety-verified-driver.jpg', alt: 'A driver profile card with a check mark on a phone' },
  { src: '/images/lifestyle/safety-share-trip.jpg', alt: 'A student sharing a live trip from their phone at night' },
  { src: '/images/lifestyle/carpool-how-it-works.jpg', alt: 'Diagram of one white SUV, three pickup pins, and an airport terminal' },
  { src: '/images/lifestyle/carpool-friends-curb.jpg', alt: 'Friends waiting at a curb for a carpool' },
  { src: '/images/lifestyle/day-to-class.jpg', alt: 'Students heading to class in daylight' },
  { src: '/images/lifestyle/day-from-campus.jpg', alt: 'Students leaving campus in the afternoon' },
  { src: '/images/lifestyle/campus-phone.jpg', alt: 'A student checking a ride on their phone on campus' },
  { src: '/images/lifestyle/library-study-group.jpg', alt: 'Students studying together with backpacks nearby' },
  { src: '/images/lifestyle/driver-student.jpg', alt: 'A student in the driver seat of a car' },
]

const manifestBySrc = new Map(imageManifest.images.map((entry) => [entry.src, entry]))

function idFromSrc(src) {
  return src.split('/').pop().replace(/\.jpg$/, '')
}

function recordFromEntry(entry) {
  const unbranded = entry.unbrandedFallback || EXTRA_UNBRANDED[entry.src] || null
  const fallback = unbranded ? manifestBySrc.get(unbranded) : null
  return {
    src: entry.src,
    alt: entry.alt,
    unbranded,
    unbrandedAlt: fallback?.alt || entry.alt,
  }
}

const IMAGES = {}
for (const entry of imageManifest.images) {
  if (!entry.src.startsWith('/images/hero/') && !entry.src.startsWith('/images/lifestyle/')) continue
  IMAGES[idFromSrc(entry.src)] = recordFromEntry(entry)
}
for (const extra of EXTRA_IMAGES) {
  const id = idFromSrc(extra.src)
  if (IMAGES[id]) continue
  IMAGES[id] = recordFromEntry(extra)
}

function readBrandedEnv() {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      const vite = import.meta.env.VITE_USE_BRANDED_PHOTOS
      if (vite != null && vite !== '') return vite
    }
  } catch {
    // Node's test runner has no Vite env object.
  }
  if (typeof process !== 'undefined' && process.env && process.env.VITE_USE_BRANDED_PHOTOS) {
    return process.env.VITE_USE_BRANDED_PHOTOS
  }
  return undefined
}

export function brandedPhotosEnabled(override) {
  if (typeof override === 'boolean') return override
  const raw = readBrandedEnv()
  if (raw == null || raw === '') return true
  return !/^(0|false|no|off)$/i.test(String(raw))
}

export const USE_BRANDED_PHOTOS = brandedPhotosEnabled()

function webpSrcSet(jpgPath) {
  const base = jpgPath.replace(/\.jpg$/, '')
  return WIDTHS.map((width) => `${base}-${width}.webp ${width}w`).join(', ')
}

export function resolveMarketingImage(id, options = {}) {
  const image = IMAGES[id]
  if (!image) return null
  const branded = brandedPhotosEnabled(options.branded)
  if (branded) {
    return { alt: image.alt, src: image.src, srcSet: webpSrcSet(image.src), sizes: SIZES }
  }
  if (!image.unbranded) return null
  return {
    alt: image.unbrandedAlt,
    src: image.unbranded,
    srcSet: webpSrcSet(image.unbranded),
    sizes: SIZES,
  }
}

export function marketingImageIds() {
  return Object.keys(IMAGES)
}
