/** Typical campus demand. Same curves as src/lib/downtownHeat.js. */

export const DOWNTOWN_VENUES = [
  { id: 'college-ave-core', name: 'College Ave', lat: 34.6839, lng: -82.8366, radius: 220, curve: 'bar' },
  { id: 'tiger-town', name: 'Tiger Town Tavern', lat: 34.6844, lng: -82.8362, radius: 90, curve: 'bar' },
  { id: 'study-hall', name: 'The Study Hall', lat: 34.6835, lng: -82.8368, radius: 80, curve: 'bar' },
  { id: 'keith-st', name: 'Keith St pickup', lat: 34.6848, lng: -82.8374, radius: 70, curve: 'late' },
]

export const CAMPUS_ANCHORS = [
  { id: 'memorial-stadium', name: 'Memorial Stadium', lat: 34.6788, lng: -82.843, radius: 280, curve: 'gameday' },
  { id: 'core-campus', name: 'Core campus', lat: 34.6784, lng: -82.8397, radius: 200, curve: 'campus' },
  { id: 'holmes-hall', name: 'Holmes Hall area', lat: 34.6762, lng: -82.8348, radius: 120, curve: 'dorm' },
  { id: 'shoeboxes', name: 'Shoeboxes / West Campus', lat: 34.6755, lng: -82.8475, radius: 140, curve: 'dorm' },
  { id: 'fraternity-row', name: 'Fraternity Row', lat: 34.6821, lng: -82.8418, radius: 110, curve: 'late' },
]

function clamp01(n) {
  return Math.max(0, Math.min(1, n))
}

function barCurve(day, hour) {
  const weekend = day === 5 || day === 6
  const thu = day === 4
  if (hour < 16) return weekend ? 0.08 : 0.04
  if (hour < 19) return weekend ? 0.28 : thu ? 0.18 : 0.1
  if (hour < 21) return weekend ? 0.55 : thu ? 0.35 : 0.18
  if (hour < 23) return weekend ? 0.92 : thu ? 0.58 : 0.28
  if (hour === 23) return weekend ? 1 : thu ? 0.7 : 0.32
  if (hour < 2) return weekend ? 0.78 : thu ? 0.45 : 0.16
  return weekend ? 0.18 : 0.06
}

function lateCurve(day, hour) {
  const weekend = day === 5 || day === 6
  if (hour >= 21 || hour < 3) return weekend ? 0.85 : 0.35
  return barCurve(day, hour) * 0.6
}

function dormCurve(day, hour) {
  const weekend = day === 5 || day === 6
  if (hour >= 7 && hour < 10) return weekend ? 0.25 : 0.55
  if (hour >= 11 && hour < 14) return 0.35
  if (hour >= 16 && hour < 19) return weekend ? 0.4 : 0.45
  if (hour >= 21 || hour < 2) return weekend ? 0.7 : 0.4
  return 0.15
}

function campusCurve(day, hour) {
  if (hour >= 8 && hour < 17) return day === 0 || day === 6 ? 0.25 : 0.55
  if (hour >= 17 && hour < 21) return 0.35
  return 0.12
}

function gamedayCurve(day, hour) {
  if (day === 6 && hour >= 10 && hour < 20) return 0.95
  if (day === 5 && hour >= 16) return 0.55
  return campusCurve(day, hour) * 0.5
}

function intensityFor(curve, day, hour) {
  if (curve === 'late') return lateCurve(day, hour)
  if (curve === 'dorm') return dormCurve(day, hour)
  if (curve === 'campus') return campusCurve(day, hour)
  if (curve === 'gameday') return gamedayCurve(day, hour)
  return barCurve(day, hour)
}

export function heatColor(intensity) {
  if (intensity >= 0.75) return '#F56600'
  if (intensity >= 0.45) return '#C45A12'
  return '#522D80'
}

export function downtownNow(date = new Date()) {
  const day = date.getDay()
  const hour = date.getHours()
  const spots = DOWNTOWN_VENUES.map((v) => ({
    ...v,
    intensity: clamp01(intensityFor(v.curve, day, hour)),
  }))
  const avg = spots.reduce((s, v) => s + v.intensity, 0) / spots.length
  let label = 'Quiet'
  if (avg >= 0.75) label = 'Packed'
  else if (avg >= 0.45) label = 'Busy'
  else if (avg >= 0.22) label = 'Picking up'
  return { day, hour, avg, label, spots }
}

export function previewDate(windowId, now = new Date()) {
  if (windowId === 'weekday_am') {
    const d = new Date(now)
    const day = d.getDay()
    // Sunday goes back to the previous Wednesday. Every other day, including
    // Saturday, uses 3 - day so the preview lands on Wednesday.
    const delta = day === 0 ? -4 : 3 - day
    d.setDate(d.getDate() + delta)
    d.setHours(8, 30, 0, 0)
    return d
  }
  if (windowId === 'friday_night') {
    const d = new Date(now)
    const day = d.getDay()
    const delta = (5 - day + 7) % 7
    d.setDate(d.getDate() + (day === 5 ? 0 : delta))
    d.setHours(22, 0, 0, 0)
    return d
  }
  return now
}

export function typicalSpots(date = new Date()) {
  const day = date.getDay()
  const hour = date.getHours()
  return [...DOWNTOWN_VENUES, ...CAMPUS_ANCHORS].map((v) => ({
    id: v.id,
    name: v.name,
    lat: v.lat,
    lng: v.lng,
    radius: v.radius,
    intensity: clamp01(intensityFor(v.curve, day, hour)),
    source: 'typical',
  }))
}

/** Same windows as src/lib/rideDemand.js resolveDemandRange for busy mode. */
export function resolveDemandRange(windowId = 'now', now = new Date()) {
  let from = new Date(now)
  const to = new Date(now)
  let hourStart = null
  let hourEnd = null
  if (windowId === 'weekday_am') {
    from = new Date(now.getTime() - 30 * 864e5)
    hourStart = 7
    hourEnd = 10
  } else if (windowId === 'friday_night') {
    from = new Date(now.getTime() - 30 * 864e5)
    hourStart = 21
    hourEnd = 23
  } else if (windowId === 'last_7d') {
    from = new Date(now.getTime() - 7 * 864e5)
  } else {
    from = new Date(now.getTime() - 14 * 864e5)
  }
  return { from, to, hourStart, hourEnd }
}
