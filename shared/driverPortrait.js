/**
 * How a driver face is shown.
 * Demo cars use their own headshot.
 * A real driver uses avatar_url when they uploaded one.
 * A real driver without a photo gets initials on orange or purple.
 * A real driver never receives a demo headshot.
 */
import { demoDriverById } from './demoFleet.js'

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
  if (url.includes('/demo-drivers/')) return ''
  return url
}

export function resolveDriverPortrait(driver) {
  const demo = driver?.isDemo === true || driver?.source === 'demo'
    ? driver
    : demoDriverById(driver?.id)
  if (demo && (driver?.isDemo === true || driver?.source === 'demo' || demoDriverById(driver?.id))) {
    const row = demoDriverById(driver?.id) || demo
    return {
      kind: 'photo',
      url: row.photoSmall || row.photo || driver.photoSmall || driver.photo,
      initials: null,
      color: null,
      isDemo: true,
    }
  }
  const photo = uploadedPhoto(driver)
  if (photo) {
    return { kind: 'photo', url: photo, initials: null, color: null, isDemo: false }
  }
  const name = driver?.full_name || driver?.fullName || driver?.name || ''
  return {
    kind: 'initials',
    url: null,
    initials: nameInitials(name),
    color: initialsBadgeColor(name),
    isDemo: false,
  }
}

/** Markup for tests and non-React callers. Real drivers never point at demo photos. */
export function renderDriverPortrait(driver) {
  const portrait = resolveDriverPortrait(driver)
  if (portrait.kind === 'photo') {
    return `<img alt="" src="${portrait.url}" data-portrait="photo" />`
  }
  return `<span data-portrait="initials" data-color="${portrait.color}">${portrait.initials}</span>`
}
