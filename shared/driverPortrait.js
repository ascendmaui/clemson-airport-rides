/**
 * How a driver face is shown.
 * Demo cars use their own headshot from demoHeadshotUrl.
 * A real driver uses an http(s) avatar_url when they uploaded one.
 * A real driver without a safe photo gets initials on orange or purple.
 * A real driver never receives a demo headshot.
 */
import { demoDriverById, demoHeadshotUrl, isDemoDriverId } from './demoFleet.js'

export const PORTRAIT_ORANGE = '#F56600'
export const PORTRAIT_PURPLE = '#522D80'

export function nameInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  const first = parts[0].slice(0, 1)
  const last = parts.length > 1 ? parts[parts.length - 1].slice(0, 1) : ''
  return (first + last).toUpperCase()
}

export function initialsBadgeColor(name) {
  const text = String(name || '')
  let hash = 0
  for (let i = 0; i < text.length; i += 1) hash = (hash + text.charCodeAt(i)) % 2
  return hash === 0 ? PORTRAIT_ORANGE : PORTRAIT_PURPLE
}

function uploadedPhoto(driver) {
  const raw = driver?.avatar_url || driver?.avatarUrl || ''
  const url = String(raw || '').trim()
  if (!url) return ''
  if (/\/demo-drivers\//i.test(url)) return ''
  if (!/^https?:\/\//i.test(url)) return ''
  if (/[\s"'<>]/.test(url)) return ''
  return url
}

function driverName(driver, catalog) {
  return driver?.full_name || driver?.fullName || driver?.name || driver?.firstName || catalog?.firstName || ''
}

export function resolveDriverPortrait(driver) {
  const headshot = demoHeadshotUrl(driver, 'small')
  if (headshot) {
    return { kind: 'photo', url: headshot, initials: null, color: null, isDemo: true }
  }
  const catalog = demoDriverById(driver?.id)
  const markedDemo = driver?.isDemo === true || driver?.source === 'demo' || isDemoDriverId(driver?.id)
  if (markedDemo) {
    const name = driverName(driver, catalog)
    return {
      kind: 'initials',
      url: null,
      initials: nameInitials(name),
      color: initialsBadgeColor(name),
      isDemo: true,
    }
  }
  const photo = uploadedPhoto(driver)
  if (photo) {
    return { kind: 'photo', url: photo, initials: null, color: null, isDemo: false }
  }
  const name = driverName(driver, null)
  return {
    kind: 'initials',
    url: null,
    initials: nameInitials(name),
    color: initialsBadgeColor(name),
    isDemo: false,
  }
}

function escapeMarkup(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Markup for tests and non-React callers. Real drivers never point at demo photos. */
export function renderDriverPortrait(driver) {
  const portrait = resolveDriverPortrait(driver)
  if (portrait.kind === 'photo' && portrait.url) {
    return `<img alt="" src="${escapeMarkup(portrait.url)}" data-portrait="photo" />`
  }
  return `<span data-portrait="initials" data-color="${escapeMarkup(portrait.color)}">${escapeMarkup(portrait.initials)}</span>`
}
