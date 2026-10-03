/** Straight-line leg estimates used until Directions returns a road path. */
export const CITY_MPS = 11.5

export function haversineMeters(aLat, aLng, bLat, bLng) {
  const lat1 = Number(aLat)
  const lng1 = Number(aLng)
  const lat2 = Number(bLat)
  const lng2 = Number(bLng)
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null
  const R = 6371000
  const p1 = (lat1 * Math.PI) / 180
  const p2 = (lat2 * Math.PI) / 180
  const dp = ((lat2 - lat1) * Math.PI) / 180
  const dl = ((lng2 - lng1) * Math.PI) / 180
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function estimateLeg(from, to, mps = CITY_MPS) {
  if (!from || !to) return null
  const meters = haversineMeters(from[0], from[1], to[0], to[1])
  if (meters == null) return null
  const speed = Number(mps) > 0 ? Number(mps) : CITY_MPS
  return { meters, seconds: meters / speed, path: [from, to] }
}

/**
 * Driver hourly rate: fare ÷ occupied time (drive to pickup + trip).
 * Returns cents per hour.
 */
export function hourlyRateCents(fareCents, toPickupSec, tripSec) {
  const fare = Number(fareCents) || 0
  const occupied = Math.max(60, (Number(toPickupSec) || 0) + (Number(tripSec) || 0))
  if (fare <= 0) return { occupiedSec: occupied, hourlyCents: 0 }
  return {
    occupiedSec: occupied,
    hourlyCents: Math.round(fare / (occupied / 3600)),
  }
}

export function minutesUntilDropoff({ selfPos, dropoff, pickup, acceptedAt, status }) {
  if (selfPos && dropoff) {
    const leg = estimateLeg(selfPos, dropoff)
    if (leg) return leg.seconds / 60
  }
  if (status === 'in_progress' && pickup && dropoff && acceptedAt) {
    const trip = estimateLeg(pickup, dropoff)
    if (!trip) return Infinity
    const elapsedMin = (Date.now() - new Date(acceptedAt).getTime()) / 60000
    if (!Number.isFinite(elapsedMin) || elapsedMin < 0) return trip.seconds / 60
    const onTrip = Math.max(0, elapsedMin * 0.6)
    return Math.max(0, trip.seconds / 60 - onTrip)
  }
  return Infinity
}

export function formatMinutes(seconds) {
  const m = Math.max(1, Math.round((Number(seconds) || 0) / 60))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

/** Google encoded polyline → [[lat, lng], ...] for an existing CampusMap route. */
export function decodePolyline(encoded) {
  if (!encoded || typeof encoded !== 'string') return null
  let index = 0
  const len = encoded.length
  let lat = 0
  let lng = 0
  const path = []
  while (index < len) {
    let b
    let shift = 0
    let result = 0
    do {
      if (index >= len) return null
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    const dlat = result & 1 ? ~(result >> 1) : result >> 1
    lat += dlat
    shift = 0
    result = 0
    do {
      if (index >= len) return null
      b = encoded.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    const dlng = result & 1 ? ~(result >> 1) : result >> 1
    lng += dlng
    path.push([lat / 1e5, lng / 1e5])
  }
  return path.length ? path : null
}

/**
 * Straight line until Directions returns. A road path replaces the estimate
 * without changing the pickup or dropoff the rider already chose.
 */
export function routePreview(origin, dest, driving = null) {
  const straight = estimateLeg(origin, dest)
  const road = driving?.path?.length ? driving.path : null
  const path = road || straight?.path || null
  if (!path) return null
  const meters = road && driving?.meters != null ? driving.meters : straight?.meters
  const seconds = road && driving?.seconds != null ? driving.seconds : straight?.seconds
  return {
    path,
    meters: meters ?? null,
    seconds: seconds ?? null,
    etaLabel: seconds != null ? `About ${formatMinutes(seconds)}` : null,
    source: road ? 'directions' : 'estimate',
  }
}

export function quoteRouteBody(origin, dest) {
  return {
    origin: { lat: origin[0], lng: origin[1] },
    destination: { lat: dest[0], lng: dest[1] },
    tier: 'standard',
  }
}

export function drivingLegFromQuote(data) {
  const path = decodePolyline(data?.polyline)
  const seconds = Number(data?.durationS)
  const meters = Number(data?.distanceM)
  if (!path || path.length < 2 || !Number.isFinite(seconds)) return null
  return {
    path,
    seconds,
    meters: Number.isFinite(meters) ? meters : null,
  }
}

export function formatMiles(meters) {
  const mi = (Number(meters) || 0) / 1609.344
  if (mi < 0.1) return '< 0.1 mi'
  return `${mi.toFixed(1)} mi`
}

export function clockTime(fromMs, plusSec) {
  const t = new Date(fromMs + Math.max(0, Number(plusSec) || 0) * 1000)
  return t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** Road path when the Maps JS Directions service is already loaded. */
export function fetchDrivingLeg(origin, dest) {
  return new Promise((resolve) => {
    const g = typeof window !== 'undefined' ? window.google?.maps : null
    if (!g?.DirectionsService || !origin || !dest) {
      resolve(null)
      return
    }
    try {
      const svc = new g.DirectionsService()
      svc.route(
        {
          origin: { lat: origin[0], lng: origin[1] },
          destination: { lat: dest[0], lng: dest[1] },
          travelMode: g.TravelMode.DRIVING,
        },
        (result, status) => {
          if (status !== 'OK' || !result?.routes?.[0]) {
            resolve(null)
            return
          }
          const route = result.routes[0]
          const leg = route.legs?.[0]
          const path = (route.overview_path || []).map((p) => [p.lat(), p.lng()])
          resolve({
            meters: leg?.distance?.value ?? null,
            seconds: leg?.duration?.value ?? null,
            path: path.length ? path : null,
          })
        },
      )
    } catch {
      resolve(null)
    }
  })
}
