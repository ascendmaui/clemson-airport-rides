/**
 * Public install targets for /download and /driver/download.
 * Store URLs stay in productLinks.js. Optional VITE_* values
 * override them at build time when they are set. Empty values keep the default.
 */
import {
  DRIVER_ANDROID_STORE_URL,
  DRIVER_IOS_STORE_URL,
  RIDER_ANDROID_STORE_URL,
  RIDER_IOS_STORE_URL,
  WEB_ORIGIN,
  publishedStoreUrl,
} from './productLinks.js'

export const CLEMSON_ORANGE = '#F56600'
export const CLEMSON_PURPLE = '#522D80'

/** Stable filenames the release workflow copies onto the VPS downloads volume. */
export const RIDER_APK_NAME = 'rider.apk'
export const DRIVER_APK_NAME = 'driver.apk'

const APK_URL = /^https:\/\/clemsonrides\.com\/downloads\/[A-Za-z0-9][A-Za-z0-9._-]*\.apk$/

const APPS = {
  rider: {
    id: 'rider',
    product: 'Clemson RIDES',
    audience: 'Riders',
    pagePath: '/download',
    apkName: RIDER_APK_NAME,
    iosStoreUrl: RIDER_IOS_STORE_URL,
    playUrl: RIDER_ANDROID_STORE_URL,
  },
  driver: {
    id: 'driver',
    product: 'Clemson RIDES Driver',
    audience: 'Drivers',
    pagePath: '/driver/download',
    apkName: DRIVER_APK_NAME,
    iosStoreUrl: DRIVER_IOS_STORE_URL,
    playUrl: DRIVER_ANDROID_STORE_URL,
  },
}

function defined(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

/** Vite inlines these literal names. Dynamic env[name] access would not. */
export function publicInstallOverrides() {
  if (typeof import.meta.env === 'undefined') {
    return {
      riderAppStore: '',
      driverAppStore: '',
      riderPlay: '',
      driverPlay: '',
      riderApk: '',
      driverApk: '',
    }
  }
  return {
    riderAppStore: defined(import.meta.env.VITE_RIDER_APP_STORE_URL),
    driverAppStore: defined(import.meta.env.VITE_DRIVER_APP_STORE_URL),
    riderPlay: defined(import.meta.env.VITE_RIDER_PLAY_URL),
    driverPlay: defined(import.meta.env.VITE_DRIVER_PLAY_URL),
    riderApk: defined(import.meta.env.VITE_RIDER_APK_URL),
    driverApk: defined(import.meta.env.VITE_DRIVER_APK_URL),
  }
}

export function apkDownloadUrl(filename, override) {
  if (typeof override === 'string' && APK_URL.test(override.trim())) return override.trim()
  return `${WEB_ORIGIN}/downloads/${filename}`
}

export function installOffer(appId, overrides = null) {
  const app = APPS[appId]
  if (!app) return null
  const extra = overrides || publicInstallOverrides()
  const appStoreOverride = appId === 'driver' ? extra.driverAppStore : extra.riderAppStore
  const playOverride = appId === 'driver' ? extra.driverPlay : extra.riderPlay
  const apkOverride = appId === 'driver' ? extra.driverApk : extra.riderApk
  // iPhone opens only a published App Store listing. Otherwise the page says coming soon.
  const iosHref = publishedStoreUrl(appStoreOverride || app.iosStoreUrl)
  const playHref = publishedStoreUrl(playOverride || app.playUrl)
  const apkHref = apkDownloadUrl(app.apkName, apkOverride)
  return {
    id: app.id,
    product: app.product,
    audience: app.audience,
    pagePath: app.pagePath,
    pageUrl: `${WEB_ORIGIN}${app.pagePath}`,
    iosHref,
    iosState: iosHref ? 'app-store' : 'coming-soon',
    androidHref: playHref || apkHref,
    androidKind: playHref ? 'play' : 'apk',
    apkHref,
  }
}

export function clientPlatform(userAgent) {
  const ua = String(userAgent || '')
  if (/Android/i.test(ua)) return 'android'
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  return 'other'
}

/** Phone visitors leave for the store or APK. Desktop stays to show the codes. */
export function redirectTarget(offer, userAgent, { stay = false } = {}) {
  if (!offer || stay) return null
  const platform = clientPlatform(userAgent)
  const target = platform === 'ios' ? offer.iosHref : platform === 'android' ? offer.androidHref : null
  if (!target || target === offer.pageUrl) return null
  return target
}
