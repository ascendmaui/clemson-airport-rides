/** Typical downtown Clemson nightlife intensity by weekday hour.
 *  Not live Uber/Lyft demand. Curves follow Fri/Sat College Ave nights.
 */
export const DOWNTOWN_CENTER = [34.6836, -82.8364]

export const DOWNTOWN_VENUES = [
  { id: 'college-ave-core', name: 'College Ave', lat: 34.6839, lng: -82.8366, radius: 220, curve: 'bar' },
  { id: 'tiger-town', name: 'Tiger Town Tavern', lat: 34.6844, lng: -82.8362, radius: 90, curve: 'bar' },
  { id: 'study-hall', name: 'The Study Hall', lat: 34.6835, lng: -82.8368, radius: 80, curve: 'bar' },
  { id: 'keith-st', name: 'Keith St pickup', lat: 34.6848, lng: -82.8374, radius: 70, curve: 'late' },
]

export const CAMPUS_ANCHORS = [
  { id: 'memorial-stadium', name: 'Memorial Stadium', lat: 34.6788, lng: -82.8430, radius: 280, curve: 'gameday' },
  { id: 'core-campus', name: 'Core campus', lat: 34.6784, lng: -82.8397, radius: 200, curve: 'campus' },
  { id: 'holmes-hall', name: 'Holmes Hall area', lat: 34.6762, lng: -82.8348, radius: 120, curve: 'dorm' },
  { id: 'shoeboxes', name: 'Shoeboxes / West Campus', lat: 34.6755, lng: -82.8475, radius: 140, curve: 'dorm' },
  { id: 'fraternity-row', name: 'Fraternity Row', lat: 34.6821, lng: -82.8418, radius: 110, curve: 'late' },
]

function clamp01(n) { return Math.max(0, Math.min(1, n)) }

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

export function typicalDemandPoints(date = new Date(), { includeCampus = true } = {}) {
  const day = date.getDay()
  const hour = date.getHours()
  const venues = includeCampus ? [...DOWNTOWN_VENUES, ...CAMPUS_ANCHORS] : DOWNTOWN_VENUES
  return venues.map((v) => {
    const intensity = clamp01(intensityFor(v.curve, day, hour))
    return { lat: v.lat, lng: v.lng, weight: Math.max(0.15, intensity) * 4, source: 'typical', id: v.id, name: v.name }
  })
}

export function heatColor(intensity) {
  if (intensity >= 0.75) return '#F56600'
  if (intensity >= 0.45) return '#C45A12'
  return '#522D80'
}
