/**
 * Marketing photos. Branded files live under public/images/hero and
 * public/images/lifestyle. Unbranded twins, when they exist, live under
 * public/images/unbranded.
 *
 * USE_BRANDED_PHOTOS defaults on. Set VITE_USE_BRANDED_PHOTOS=false to hide
 * lifestyle shots that have no unbranded twin instead of showing branded ones.
 * Hero shots fall back to their unbranded files.
 */

const WIDTHS = [480, 768, 1280]

export const HERO_COLLAGE = [
  { id: 'students-carpool-street', className: 'mkt-hero-shot mkt-hero-shot--lead', eager: true },
  { id: 'students-stadium-request', className: 'mkt-hero-shot mkt-hero-shot--request', eager: false },
  { id: 'students-carpool-backseat', className: 'mkt-hero-shot mkt-hero-shot--backseat', eager: false },
]

export const FEATURE_IMAGES = {
  student: 'library-study-group',
  gameday: 'gameday-crowd',
  matching: 'college-ave-request',
  tracking: 'campus-phone',
}

const IMAGES = {
  'students-carpool-street': {
    src: '/images/hero/students-carpool-street.jpg',
    unbranded: '/images/unbranded/students-carpool-street.jpg',
    alt: 'Three students in white tops leaning from the windows of a pearl-white SUV at a red light',
  },
  'students-stadium-request': {
    src: '/images/hero/students-stadium-request.jpg',
    unbranded: '/images/unbranded/students-stadium-request.jpg',
    alt: 'A student on outdoor stadium steps at dusk, holding a phone up to request a ride',
  },
  'students-carpool-backseat': {
    src: '/images/hero/students-carpool-backseat.jpg',
    unbranded: '/images/unbranded/students-carpool-backseat.jpg',
    alt: 'Three friends in the back seat of a carpool, talking on the way to campus',
  },
  'night-going-out': {
    src: '/images/lifestyle/night-going-out.jpg',
    alt: 'Four students walking together on a lit downtown street at night',
  },
  'night-live-tracking': {
    src: '/images/lifestyle/night-live-tracking.jpg',
    alt: 'A phone showing a live ride on a map during a night out',
  },
  'night-sos': {
    src: '/images/lifestyle/night-sos.jpg',
    alt: 'A student using the in-app SOS control at night',
  },
  'night-orange-screen': {
    src: '/images/lifestyle/night-orange-screen.jpg',
    alt: 'A phone open to an orange ride screen on a nighttime street',
  },
  'safety-recording': {
    src: '/images/lifestyle/safety-recording.jpg',
    alt: 'A phone on a car console with a microphone button ready to record audio',
  },
  'safety-verified-driver': {
    src: '/images/lifestyle/safety-verified-driver.jpg',
    alt: 'A driver profile card with a check mark on a phone',
  },
  'safety-share-trip': {
    src: '/images/lifestyle/safety-share-trip.jpg',
    alt: 'A student sharing a live trip from their phone at night',
  },
  'carpool-how-it-works': {
    src: '/images/lifestyle/carpool-how-it-works.jpg',
    alt: 'Diagram of one white SUV, three pickup pins, and an airport terminal',
  },
  'carpool-friends-curb': {
    src: '/images/lifestyle/carpool-friends-curb.jpg',
    alt: 'Friends waiting at a curb for a carpool',
  },
  'airport-on-time': {
    src: '/images/lifestyle/airport-on-time.jpg',
    alt: 'Students with luggage outside an airport terminal',
  },
  'college-ave-request': {
    src: '/images/lifestyle/college-ave-request.jpg',
    alt: 'A student requesting a ride on a phone along a campus avenue',
  },
  'day-to-class': {
    src: '/images/lifestyle/day-to-class.jpg',
    alt: 'Students heading to class in daylight',
  },
  'day-from-campus': {
    src: '/images/lifestyle/day-from-campus.jpg',
    alt: 'Students leaving campus in the afternoon',
  },
  'campus-phone': {
    src: '/images/lifestyle/campus-phone.jpg',
    alt: 'A student checking a ride on their phone on campus',
  },
  'library-study-group': {
    src: '/images/lifestyle/library-study-group.jpg',
    alt: 'Students studying together with backpacks nearby',
  },
  'gameday-crowd': {
    src: '/images/lifestyle/gameday-crowd.jpg',
    alt: 'A crowd outside the stadium on game day',
  },
  'driver-student': {
    src: '/images/lifestyle/driver-student.jpg',
    alt: 'A student in the driver seat of a car',
  },
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

function webpSrcSet(jpgPath) {
  const base = jpgPath.replace(/\.jpg$/, '')
  return WIDTHS.map((width) => `${base}-${width}.webp ${width}w`).join(', ')
}

export function resolveMarketingImage(id, options = {}) {
  const image = IMAGES[id]
  if (!image) return null
  const branded = brandedPhotosEnabled(options.branded)
  if (branded) {
    return { ...image, src: image.src, srcSet: webpSrcSet(image.src), sizes: '(min-width: 960px) 340px, 62vw' }
  }
  if (!image.unbranded) return null
  return {
    ...image,
    src: image.unbranded,
    srcSet: webpSrcSet(image.unbranded),
    sizes: '(min-width: 960px) 340px, 62vw',
  }
}

export function marketingImageIds() {
  return Object.keys(IMAGES)
}
