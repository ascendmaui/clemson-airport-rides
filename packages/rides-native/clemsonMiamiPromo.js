/**
 * $1 point-to-point ride inside Clemson to the Clemson vs Miami game.
 * Saturday October 3, 2026, America/New_York, through 7:30 PM.
 * October 3, 2026 is still EDT (UTC−4); DST ends November 1, 2026.
 * Client prices are not inputs. The server charges 100 cents or it does not.
 */

export const CLEMSON_MIAMI_RIDE = 'clemson-miami'
export const CLEMSON_MIAMI_PROMO_ID = 'clemson-miami-2026-10-03'
export const CLEMSON_MIAMI_FARE_CENTS = 100

/** Public signup link. Signing in through the same ride query applies it too. */
export const CLEMSON_MIAMI_PUBLIC_URL = 'https://clemsonrides.com/#/sign-up?ride=clemson-miami'

/** College Avenue stop from the campus catalog. Inside Clemson, not an airport. */
export const CLEMSON_MIAMI_PICKUP = {
  label: 'College Avenue, Clemson, South Carolina',
  lat: 34.6839,
  lng: -82.8366,
}

/** Memorial Stadium, Clemson. The October 3, 2026 Clemson vs Miami game. */
export const CLEMSON_MIAMI_DROPOFF = {
  label: 'Clemson Miami game',
  lat: 34.6788,
  lng: -82.843,
}

export const CLEMSON_MIAMI_START_MS = Date.UTC(2026, 9, 3, 4, 0, 0)
export const CLEMSON_MIAMI_END_MS = Date.UTC(2026, 9, 3, 23, 30, 0)

function instant(now) {
  const at = now instanceof Date ? now : new Date(now)
  const ms = at.getTime()
  return Number.isFinite(ms) ? ms : NaN
}

export function clemsonMiamiPromoOpen(now = new Date()) {
  const ms = instant(now)
  if (!Number.isFinite(ms)) return false
  return ms >= CLEMSON_MIAMI_START_MS && ms <= CLEMSON_MIAMI_END_MS
}

export function clemsonMiamiRemainingLabel(now = new Date()) {
  const ms = instant(now)
  const left = Number.isFinite(ms) ? CLEMSON_MIAMI_END_MS - ms : 0
  const mins = left <= 0 ? 0 : Math.ceil(left / 60000)
  if (mins >= 60) {
    const hr = Math.floor(mins / 60)
    const min = mins % 60
    return `${hr} hr ${min} min until 7:30 PM`
  }
  return `${mins} min until 7:30 PM`
}

export function clemsonMiamiDriverNotification(now = new Date()) {
  const remaining = clemsonMiamiRemainingLabel(now)
  return {
    title: 'Promo ride',
    body: `Promo ride · fare $1 · pickup within Clemson at ${CLEMSON_MIAMI_PICKUP.label} · destination ${CLEMSON_MIAMI_DROPOFF.label} · ${remaining}`,
  }
}

export function isClemsonMiamiPromoRow(row) {
  const meta = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {}
  if (meta.promo !== CLEMSON_MIAMI_PROMO_ID && meta.promo_ride !== true) return false
  const status = String(row?.status || '').toLowerCase()
  return status !== 'canceled' && status !== 'cancelled'
}
