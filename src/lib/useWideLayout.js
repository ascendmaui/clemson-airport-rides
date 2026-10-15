import { useEffect, useState } from 'react'

/** Wide booking layout: map plus side card. Matches .app-shell--wide in booking.css. */
export const WIDE_BOOKING_QUERY = '(min-width: 1100px)'

export function useWideLayout(query = WIDE_BOOKING_QUERY) {
  const [wide, setWide] = useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
  ))
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const media = window.matchMedia(query)
    const apply = () => setWide(media.matches)
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [query])
  return wide
}
