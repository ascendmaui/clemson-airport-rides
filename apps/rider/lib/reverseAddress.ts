/** Turn a device reverse-geocode result into a single address line. */
export type ReverseParts = {
  name?: string | null
  street?: string | null
  streetNumber?: string | null
  city?: string | null
  region?: string | null
}

export function addressFromGeocode(place: ReverseParts | null | undefined): string {
  if (!place) return ''
  const street = [place.streetNumber, place.street].filter(Boolean).join(' ').trim()
  const name = String(place.name || '').trim()
  const primary = name && name !== street ? name : street
  const city = String(place.city || '').trim()
  const region = String(place.region || '').trim()
  const tail = [city, region].filter(Boolean).join(', ')
  return [primary, tail].filter(Boolean).join(', ')
}
