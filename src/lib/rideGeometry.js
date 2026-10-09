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

export function formatMiles(meters) {
  const mi = (Number(meters) || 0) / 1609.344
  if (mi < 0.1) return '< 0.1 mi'
  return `${mi.toFixed(1)} mi`
}

export function clockTime(fromMs, plusSec) {
  const t = new Date(fromMs + Math.max(0, Number(plusSec) || 0) * 1000)
  return t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/**
 * Browser Directions fallback when the trip has no snapped road.
 * Origin is rounded to ~1.1 km so a moving car does not request every fix.
 * Legs longer than DIRECTIONS_MAX_METERS stay on the straight line (airport
 * trips should already have a stored polyline from booking).
 */
export const DIRECTIONS_MAX_METERS = 12000

const drivingLegCache = new Map()

export function drivingLegKey(origin, dest) {
  const oLat = Number(origin?.[0])
  const oLng = Number(origin?.[1])
  const dLat = Number(dest?.[0])
  const dLng = Number(dest?.[1])
  if (![oLat, oLng, dLat, dLng].every(Number.isFinite)) return null
  return `${oLat.toFixed(2)},${oLng.toFixed(2)}>${dLat.toFixed(4)},${dLng.toFixed(4)}`
}

export function shouldRequestDrivingLeg(origin, dest) {
  const meters = haversineMeters(origin?.[0], origin?.[1], dest?.[0], dest?.[1])
  return meters != null && meters > 40 && meters <= DIRECTIONS_MAX_METERS
}

export function readDrivingLeg(key) {
  if (!key) return null
  return drivingLegCache.get(key) || null
}

export function rememberDrivingLeg(key, leg) {
  if (!key || !leg?.path?.length) return
  if (drivingLegCache.size >= 40) {
    const oldest = drivingLegCache.keys().next().value
    drivingLegCache.delete(oldest)
  }
  drivingLegCache.set(key, leg)
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
