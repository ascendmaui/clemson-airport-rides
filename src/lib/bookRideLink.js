import { WEB_ORIGIN } from '../../shared/productLinks.js'
import { BOOK_RIDE_PATH } from '../../shared/appLinks.js'

const APEX = 'clemsonrides.com'

export function isIosUserAgent(userAgent) {
  return /iPad|iPhone|iPod/.test(String(userAgent || ''))
}

/**
 * iOS opens an installed app from a universal link when the tapped host is
 * not the host the person is already browsing. From clemsonrides.com the
 * link uses www, and from www it uses the apex. www still redirects to the
 * apex for /book, so a phone without the app lands on the web booking page.
 * Every other browser stays on this origin's /book.
 */
export function bookRideHref(input) {
  if (!input && typeof window !== 'undefined' && window.location) {
    return bookRideHref({
      hostname: window.location.hostname,
      origin: window.location.origin,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    })
  }
  const hostname = String(input?.hostname || '')
  const origin = input?.origin || ''
  if (isIosUserAgent(input?.userAgent) && (hostname === APEX || hostname === `www.${APEX}`)) {
    const linkHost = hostname === APEX ? `www.${APEX}` : APEX
    return `https://${linkHost}${BOOK_RIDE_PATH}`
  }
  if (origin) return `${origin}${BOOK_RIDE_PATH}`
  return `${WEB_ORIGIN}${BOOK_RIDE_PATH}`
}
