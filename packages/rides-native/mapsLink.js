/**
 * Turn a stop into Apple Maps and Google Maps directions URLs.
 * Callers open them with the platform linker. No SDK key.
 */

function coord(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function navigationLinks({ latitude, longitude, label } = {}) {
  const lat = coord(latitude)
  const lng = coord(longitude)
  const name = String(label || '').trim()
  const query = encodeURIComponent(name || 'Destination')
  const hasPoint = lat != null && lng != null
  const apple = hasPoint
    ? `http://maps.apple.com/?daddr=${lat},${lng}&q=${query}&dirflg=d`
    : `http://maps.apple.com/?q=${query}`
  const google = hasPoint
    ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`
    : `https://www.google.com/maps/dir/?api=1&destination=${query}&travelmode=driving`
  return { apple, google, hasPoint }
}
