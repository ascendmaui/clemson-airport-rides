/** Sunrise and sunset for the driver theme. Clemson, SC is the fallback. */

export const CLEMSON_LAT = 34.6784
export const CLEMSON_LNG = -82.8397

export type SunTimes = {
  sunrise: Date
  sunset: Date
}

function norm360(value: number): number {
  const wrapped = value % 360
  return wrapped < 0 ? wrapped + 360 : wrapped
}

function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0)
  return Math.floor((date.getTime() - start.getTime()) / 86400000)
}

/** NOAA solar calculator. Returns null for a polar day or night. */
export function sunTimes(date: Date, latitude: number, longitude: number): SunTimes | null {
  const zenith = 90.833
  const rad = Math.PI / 180
  const n = dayOfYear(date)
  const lngHour = longitude / 15

  function event(sunrise: boolean): number | null {
    const t = n + ((sunrise ? 6 : 18) - lngHour) / 24
    const m = 0.9856 * t - 3.289
    let l = m + 1.916 * Math.sin(m * rad) + 0.02 * Math.sin(2 * m * rad) + 282.634
    l = norm360(l)
    let ra = Math.atan(0.91764 * Math.tan(l * rad)) / rad
    ra = norm360(ra)
    const lQuad = Math.floor(l / 90) * 90
    const raQuad = Math.floor(ra / 90) * 90
    ra = (ra + (lQuad - raQuad)) / 15
    const sinDec = 0.39782 * Math.sin(l * rad)
    const cosDec = Math.cos(Math.asin(sinDec))
    const cosH = (Math.cos(zenith * rad) - sinDec * Math.sin(latitude * rad)) / (cosDec * Math.cos(latitude * rad))
    if (cosH > 1 || cosH < -1) return null
    const hDeg = sunrise ? 360 - Math.acos(cosH) / rad : Math.acos(cosH) / rad
    const h = hDeg / 15
    let ut = h + ra - 0.06571 * t - 6.622 - lngHour
    ut = ((ut % 24) + 24) % 24
    return ut
  }

  const riseHours = event(true)
  const setHours = event(false)
  if (riseHours == null || setHours == null) return null

  const utcMidnight = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  return {
    sunrise: new Date(utcMidnight + riseHours * 3600000),
    sunset: new Date(utcMidnight + setHours * 3600000),
  }
}

export function isDaylight(
  date: Date,
  latitude = CLEMSON_LAT,
  longitude = CLEMSON_LNG,
): boolean {
  const times = sunTimes(date, latitude, longitude)
  if (!times) return true
  return date.getTime() >= times.sunrise.getTime() && date.getTime() < times.sunset.getTime()
}
