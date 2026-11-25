/**
 * Clemson Rides student plans: the Weekend Carpool Plan and the personalized
 * usage-based plan. Pure, rules-based math shared by the server, the nightly
 * quote job, and the rider app. AI only writes the one-line summary; every
 * number here can be explained and checked by hand.
 *
 * Everything is behind STUDENT_PLANS_ENABLED (default OFF). A per-rider
 * allowlist (STUDENT_PLANS_ALLOW_EMAILS / STUDENT_PLANS_ALLOW_IDS) turns it on
 * for named testers while the global flag stays off.
 */

export const PRODUCT_NAME = 'Clemson Rides'
export const PLAN_BADGE_COLOR = '#F56600'
export const BUSINESS_ADDRESS = '101 North Main Street, Greenville, SC 29601'
export const COVERED_LABEL = 'Covered'

export const DRIVER_SHARE_BPS = 8000
export const STRIPE_FEE_BPS = 290
export const STRIPE_FEE_FIXED_CENTS = 30
export const MIN_MARGIN_BPS = 1500
export const MONTHLY_DISCOUNT_BPS = 1000
export const SEMESTER_DISCOUNT_BPS = 1500
export const SCHOOL_MONTHS_PER_YEAR = 8
export const SCHOOL_MONTHS_PER_SEMESTER = 4
export const WEEKS_PER_MONTH = 4.33
export const NOVELTY_DECAY_BPS = 1500
export const QUOTE_TRIGGER_RIDES = 5
export const QUOTE_MIN_HISTORY_DAYS = 14
export const QUOTE_LOOKBACK_DAYS = 60
export const QUOTE_VALID_DAYS = 14
export const QUOTE_PRICE_LOCK_MONTHS = 3
export const TRIAL_DAYS = 7
export const TIME_ZONE = 'America/New_York'
export const CAMPUS_ANCHOR = { lat: 34.6788, lng: -82.8432, label: 'Memorial Stadium / Bowman Field' }

export const PLAN_IDS = Object.freeze({
  WEEKEND_CARPOOL: 'weekend_carpool',
  PERSONALIZED: 'personalized',
})

export const WEEKEND_CARPOOL_PLAN = Object.freeze({
  id: PLAN_IDS.WEEKEND_CARPOOL,
  name: 'Weekend Carpool Plan',
  monthlyCents: 8900,
  semesterCents: 34900,
  fourYearAnchorCents: 299900,
  billedMonthsPerYear: SCHOOL_MONTHS_PER_YEAR,
  minRiders: 2,
  nights: [5, 6], // Friday, Saturday (0 = Sunday)
  surgeCapBps: 12000,
  driverShareBps: DRIVER_SHARE_BPS,
})

export const DEFAULT_WINDOW = Object.freeze({ startHour: 18, endHour: 4 })

/** Default pause windows; override with STUDENT_PLAN_PAUSE_WINDOWS (JSON). */
export const DEFAULT_PAUSE_WINDOWS = Object.freeze([
  { kind: 'fall_break', label: 'Fall break', start: '2026-10-19', end: '2026-10-20' },
  { kind: 'exams', label: 'Fall exams', start: '2026-12-07', end: '2026-12-11' },
  { kind: 'winter_break', label: 'Winter break', start: '2026-12-12', end: '2027-01-06' },
  { kind: 'spring_break', label: 'Spring break', start: '2027-03-15', end: '2027-03-19' },
  { kind: 'exams', label: 'Spring exams', start: '2027-04-29', end: '2027-05-05' },
])
export const PAUSE_KINDS = ['fall_break', 'winter_break', 'spring_break', 'exams', 'leave_of_absence']

// ---------- feature flag ----------

function flagOn(value) {
  const v = String(value ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'on'
}

function list(raw) {
  return String(raw || '').split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
}

/** OFF unless the global flag is on or this rider is allowlisted. */
export function studentPlansEnabled(env = {}, user = null) {
  if (flagOn(env.STUDENT_PLANS_ENABLED)) return true
  if (!user) return false
  const email = String(user.email || '').trim().toLowerCase()
  const id = String(user.id || '').trim().toLowerCase()
  if (email && list(env.STUDENT_PLANS_ALLOW_EMAILS).includes(email)) return true
  if (id && list(env.STUDENT_PLANS_ALLOW_IDS).includes(id)) return true
  return false
}

/** Email sending is a separate switch and is OFF. Preview / dry-run only. */
export function studentPlanEmailSendingEnabled(env = {}) {
  return flagOn(env.STUDENT_PLAN_EMAILS_SEND) && flagOn(env.STUDENT_PLANS_ENABLED)
}

// ---------- money ----------

export function stripeFeeCents(priceCents) {
  return Math.round((priceCents * STRIPE_FEE_BPS) / 10000) + STRIPE_FEE_FIXED_CENTS
}

/**
 * Lowest allowed monthly price: driver pay (80% of projected fares) plus
 * Stripe fees on that price, plus a 15% margin on those costs.
 * Solves P = 1.15 * (D + 0.029P + 0.30).
 */
export function quoteFloorCents(projectedFaresCents, { marginBps = MIN_MARGIN_BPS } = {}) {
  const driver = Math.round((Math.max(0, projectedFaresCents) * DRIVER_SHARE_BPS) / 10000)
  const m = 1 + marginBps / 10000
  const floor = (m * (driver + STRIPE_FEE_FIXED_CENTS)) / (1 - (m * STRIPE_FEE_BPS) / 10000)
  return Math.ceil(floor)
}

export function clearsFloor(priceCents, projectedFaresCents) {
  return priceCents >= quoteFloorCents(projectedFaresCents)
}

/** Billing discount on the projected pay-per-ride cost. The floor always wins. */
export function discountedPrice(retailCents, floorCents, bps) {
  const discounted = Math.round(retailCents * (1 - bps / 10000))
  return { cents: Math.max(discounted, floorCents), floorApplied: discounted < floorCents }
}

export function roundUpToDollar(cents) {
  return Math.ceil(cents / 100) * 100
}

export function formatUsd(cents) {
  const n = Math.round(cents) / 100
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`
}

// ---------- time helpers (America/New_York) ----------

const etParts = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE, weekday: 'short', hour: 'numeric', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
})
const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

export function easternClock(at) {
  const d = at instanceof Date ? at : new Date(at)
  const p = Object.fromEntries(etParts.formatToParts(d).map((x) => [x.type, x.value]))
  return { dow: DOW[p.weekday], hour: Number(p.hour) % 24, month: Number(p.month), day: Number(p.day), year: Number(p.year) }
}

export function easternDate(at) {
  const c = easternClock(at)
  return `${c.year}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`
}

/** True for Fri/Sat night inside the window (default 6 PM to 4 AM ET). */
export function inWeekendWindow(at, window = DEFAULT_WINDOW, nights = WEEKEND_CARPOOL_PLAN.nights) {
  const { dow, hour } = easternClock(at)
  const { startHour, endHour } = window
  if (startHour <= endHour) return nights.includes(dow) && hour >= startHour && hour < endHour
  if (nights.includes(dow) && hour >= startHour) return true
  const prev = (dow + 6) % 7
  return nights.includes(prev) && hour < endHour
}

export function windowFromEnv(env = {}) {
  const s = Number.parseInt(env.WEEKEND_CARPOOL_WINDOW_START_HOUR, 10)
  const e = Number.parseInt(env.WEEKEND_CARPOOL_WINDOW_END_HOUR, 10)
  return {
    startHour: Number.isInteger(s) && s >= 0 && s < 24 ? s : DEFAULT_WINDOW.startHour,
    endHour: Number.isInteger(e) && e >= 0 && e < 24 ? e : DEFAULT_WINDOW.endHour,
  }
}

export function pauseWindowsFromEnv(env = {}) {
  try {
    const raw = env.STUDENT_PLAN_PAUSE_WINDOWS
    if (!raw) return DEFAULT_PAUSE_WINDOWS
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_PAUSE_WINDOWS
    return parsed.filter((w) => w && PAUSE_KINDS.includes(w.kind) && /^\d{4}-\d{2}-\d{2}$/.test(w.start) && /^\d{4}-\d{2}-\d{2}$/.test(w.end) && w.start <= w.end)
  } catch {
    return DEFAULT_PAUSE_WINDOWS
  }
}

/**
 * Validates a pause request. Break/exam pauses must match a configured window;
 * leave_of_absence takes any range up to 12 months.
 */
export function validatePause({ kind, start, end }, windows = DEFAULT_PAUSE_WINDOWS) {
  if (!PAUSE_KINDS.includes(kind)) return { ok: false, code: 'bad_kind' }
  if (kind === 'leave_of_absence') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || '') || start > end) {
      return { ok: false, code: 'bad_range' }
    }
    const days = (Date.parse(end) - Date.parse(start)) / 86400000
    if (days > 366) return { ok: false, code: 'too_long' }
    return { ok: true, start, end, kind }
  }
  const match = windows.find((w) => w.kind === kind && (!start || w.start === start))
  if (!match) return { ok: false, code: 'no_window' }
  return { ok: true, start: match.start, end: match.end, kind, label: match.label }
}

export function pausedOn(dateStr, pauses = []) {
  return pauses.some((p) => !p.canceled_at && p.start_date <= dateStr && dateStr <= p.end_date)
}

// ---------- coverage ----------

/**
 * Weekend Carpool Plan coverage for one fare. Covers matched carpools with 2+
 * riders inside the window, up to a 1.2x surge. The rider pays the surge
 * above 1.2x. The driver is still paid 80% of the full fare.
 */
export function weekendCarpoolCoverage({
  fareCents, surgeMultiplier = 1, riders = 1, carpool = false, at, window = DEFAULT_WINDOW, active = true,
}) {
  const full = Math.max(0, Math.round(fareCents || 0))
  const driverPayoutCents = Math.round((full * DRIVER_SHARE_BPS) / 10000)
  const base = { fareCents: full, driverPayoutCents }
  if (!active) return { ...base, covered: false, reason: 'no_plan', coveredCents: 0, riderPaysCents: full, label: null }
  if (!carpool || riders < WEEKEND_CARPOOL_PLAN.minRiders) {
    return { ...base, covered: false, reason: 'not_matched_carpool', coveredCents: 0, riderPaysCents: full, label: null }
  }
  if (!inWeekendWindow(at, window)) {
    return { ...base, covered: false, reason: 'outside_window', coveredCents: 0, riderPaysCents: full, label: null }
  }
  const surge = Math.max(1, Number(surgeMultiplier) || 1)
  const cap = WEEKEND_CARPOOL_PLAN.surgeCapBps / 10000
  const coveredCents = surge <= cap ? full : Math.round((full * cap) / surge)
  const riderPaysCents = full - coveredCents
  return {
    ...base,
    covered: true,
    reason: riderPaysCents > 0 ? 'surge_above_cap' : 'covered',
    coveredCents,
    riderPaysCents,
    label: riderPaysCents > 0 ? `${COVERED_LABEL} · you pay ${formatUsd(riderPaysCents)} surge` : COVERED_LABEL,
  }
}

// ---------- ride-history analysis ----------

function median(nums) {
  if (!nums.length) return 0
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

function mean(nums) {
  return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0
}

export function haversineMiles(a, b) {
  if (![a?.lat, a?.lng, b?.lat, b?.lng].every((v) => Number.isFinite(Number(v)))) return null
  const R = 3958.8
  const rad = (d) => (Number(d) * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function tripMiles(trip) {
  const fb = trip.fare_breakdown || {}
  const m = Number(fb.distanceMiles ?? fb.miles ?? trip.metadata?.distanceMiles)
  if (Number.isFinite(m) && m > 0) return m
  const meters = Number(fb.distanceM ?? fb.distance_m ?? trip.metadata?.distance_m)
  if (Number.isFinite(meters) && meters > 0) return meters / 1609.344
  const crow = haversineMiles({ lat: trip.pickup_lat, lng: trip.pickup_lng }, { lat: trip.dropoff_lat, lng: trip.dropoff_lng })
  return crow == null ? null : crow * 1.3
}

export function isCarpoolTrip(trip) {
  const tier = String(trip.tier || '').toLowerCase()
  return tier.includes('carpool') || Boolean(trip.metadata?.carpool || trip.metadata?.carpool_group_id)
}

/** Completed and paid; cancelled and refunded rides do not count. */
export function countsAsCompleted(trip) {
  return trip?.status === 'completed' && trip?.payment_status === 'paid'
}

function isGameDay(at) {
  const c = easternClock(at)
  return c.dow === 6 && c.month >= 8 && c.month <= 11 && c.hour >= 11 && c.hour < 23
}

function cluster(lat, lng) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null
  return `${Number(lat).toFixed(2)},${Number(lng).toFixed(2)}`
}

function topCounts(map, n) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([key, count]) => ({ key, count }))
}

export function classifyPattern({ weekendNightShare, gameDayShare, weekdayDaytimeShare }) {
  if (weekendNightShare >= 0.8) return 'weekend_nightlife'
  if (gameDayShare >= 0.5) return 'game_day_heavy'
  if (weekdayDaytimeShare >= 0.6) return 'commuter'
  return 'mixed'
}

export const PATTERN_COPY = {
  weekend_nightlife: 'Friday and Saturday nights',
  game_day_heavy: 'game days',
  commuter: 'weekday commutes',
  mixed: 'a mix of days and times',
}

/** Rules-based metrics from the last 60 days of completed, paid rides. */
export function analyzeRides(trips, { now = new Date(), window = DEFAULT_WINDOW } = {}) {
  const at = (t) => new Date(t.completed_at || t.pickup_at || t.requested_at || t.created_at)
  const done = trips.filter(countsAsCompleted).sort((a, b) => at(a) - at(b))
  const cutoff = now.getTime() - QUOTE_LOOKBACK_DAYS * 86400000
  const recent = done.filter((t) => at(t).getTime() >= cutoff)
  const used = recent.length >= QUOTE_TRIGGER_RIDES ? recent : done
  const n = used.length
  if (!n) return { rides: 0 }
  const firstAt = at(used[0]).getTime()
  const historyDays = Math.max(1, (now.getTime() - at(done[0]).getTime()) / 86400000)
  const spanDays = Math.max(7, (now.getTime() - firstAt) / 86400000)
  const fares = used.map((t) => Math.max(0, Number(t.fare_cents) || 0))
  const preSurge = used.map((t) => Math.round((Number(t.fare_cents) || 0) / Math.max(1, Number(t.surge_multiplier) || 1)))
  const miles = used.map(tripMiles).filter((m) => m != null)
  const dowHist = Array(7).fill(0)
  const hourHist = Array(24).fill(0)
  let weekendNight = 0
  let gameDay = 0
  let weekdayDay = 0
  let surged = 0
  let carpool = 0
  const nightEnds = new Map()
  const routes = new Map()
  for (const t of used) {
    const when = at(t)
    const c = easternClock(when)
    dowHist[c.dow] += 1
    hourHist[c.hour] += 1
    if (inWeekendWindow(when, window)) weekendNight += 1
    if (isGameDay(when)) gameDay += 1
    if (c.dow >= 1 && c.dow <= 5 && c.hour >= 7 && c.hour < 18) weekdayDay += 1
    if ((Number(t.surge_multiplier) || 1) > 1) surged += 1
    if (isCarpoolTrip(t)) carpool += 1
    const o = cluster(t.pickup_lat, t.pickup_lng)
    const d = cluster(t.dropoff_lat, t.dropoff_lng)
    if (c.hour >= 18 || c.hour < 4) {
      for (const k of [o, d]) if (k) nightEnds.set(k, (nightEnds.get(k) || 0) + 1)
    }
    if (o && d) routes.set(`${o}→${d}`, (routes.get(`${o}→${d}`) || 0) + 1)
  }
  const homeKey = topCounts(nightEnds, 1)[0]?.key || null
  const home = homeKey ? { lat: Number(homeKey.split(',')[0]), lng: Number(homeKey.split(',')[1]) } : null
  const weeklyRate = n / (spanDays / 7)
  const projectedRidesPerMonth = Math.round(weeklyRate * WEEKS_PER_MONTH * (1 - NOVELTY_DECAY_BPS / 10000) * 10) / 10
  const medianFareCents = median(fares)
  const shares = {
    weekendNightShare: weekendNight / n,
    gameDayShare: gameDay / n,
    weekdayDaytimeShare: weekdayDay / n,
  }
  return {
    rides: n,
    totalCompleted: done.length,
    historyDays: Math.floor(historyDays),
    medianFareCents,
    averageFareCents: mean(fares),
    medianPreSurgeFareCents: median(preSurge),
    averagePreSurgeFareCents: mean(preSurge),
    surgeShare: surged / n,
    medianMiles: miles.length ? Math.round(median(miles.map((m) => m * 100)) ) / 100 : null,
    homeAnchor: home,
    homeToCampusMiles: home ? Math.round(haversineMiles(home, CAMPUS_ANCHOR) * 100) / 100 : null,
    weeklyRate: Math.round(weeklyRate * 100) / 100,
    projectedRidesPerMonth,
    projectedMonthlyCostCents: Math.round(projectedRidesPerMonth * medianFareCents),
    dowHistogram: dowHist,
    hourHistogram: hourHist,
    topRoutes: topCounts(routes, 3),
    carpoolShare: carpool / n,
    ...shares,
    pattern: classifyPattern(shares),
  }
}

// ---------- quote ----------

/**
 * Picks the cheapest plan that covers projected use and clears the margin
 * floor. Returns recommendation 'tiger_pass' (no discount) when nothing does.
 */
export function buildQuote(metrics, { now = new Date() } = {}) {
  const retail = metrics.projectedMonthlyCostCents || 0
  const floor = quoteFloorCents(retail)
  const candidates = []

  const monthly = discountedPrice(retail, floor, MONTHLY_DISCOUNT_BPS)
  const semesterFloor = floor * SCHOOL_MONTHS_PER_SEMESTER
  const semester = discountedPrice(retail * SCHOOL_MONTHS_PER_SEMESTER, semesterFloor, SEMESTER_DISCOUNT_BPS)
  const personalized = {
    planId: PLAN_IDS.PERSONALIZED,
    name: 'Your Clemson Rides Plan',
    ridesPerMonth: Math.max(1, Math.ceil(metrics.projectedRidesPerMonth || 0)),
    monthlyCents: roundUpToDollar(monthly.cents),
    semesterCents: roundUpToDollar(semester.cents),
    floorApplied: monthly.floorApplied,
  }
  if (personalized.monthlyCents < retail) candidates.push(personalized)

  const weekendFits = metrics.pattern === 'weekend_nightlife' && (metrics.carpoolShare || 0) >= 0.3
  if (weekendFits && clearsFloor(WEEKEND_CARPOOL_PLAN.monthlyCents, retail) && WEEKEND_CARPOOL_PLAN.monthlyCents < retail) {
    candidates.push({
      planId: PLAN_IDS.WEEKEND_CARPOOL,
      name: WEEKEND_CARPOOL_PLAN.name,
      monthlyCents: WEEKEND_CARPOOL_PLAN.monthlyCents,
      semesterCents: WEEKEND_CARPOOL_PLAN.semesterCents,
      floorApplied: false,
    })
  }

  const expiresAt = new Date(now.getTime() + QUOTE_VALID_DAYS * 86400000).toISOString()
  const best = candidates.sort((a, b) => a.monthlyCents - b.monthlyCents)[0]
  if (!best) {
    return {
      recommendation: 'tiger_pass',
      planId: null,
      retailMonthlyCents: retail,
      floorCents: floor,
      monthlyCents: null,
      semesterCents: null,
      savingsCents: 0,
      expiresAt,
      priceLockMonths: QUOTE_PRICE_LOCK_MONTHS,
    }
  }
  return {
    recommendation: best.planId,
    ...best,
    retailMonthlyCents: retail,
    floorCents: floor,
    savingsCents: retail - best.monthlyCents,
    expiresAt,
    priceLockMonths: QUOTE_PRICE_LOCK_MONTHS,
    fourYearAnchorCents: WEEKEND_CARPOOL_PLAN.fourYearAnchorCents,
  }
}

/** Deterministic fallback for the AI summary sentence. */
export function fallbackSummary(metrics, quote) {
  const rides = Math.round(metrics.projectedRidesPerMonth || 0)
  const where = PATTERN_COPY[metrics.pattern] || PATTERN_COPY.mixed
  if (!quote.planId) {
    return `You ride about ${rides} times a month, mostly ${where}. Tiger Pass is your best value right now.`
  }
  return `You ride about ${rides} times a month, mostly ${where}. You've spent about ${formatUsd(quote.retailMonthlyCents)} a month. With the ${quote.name} you'd pay ${formatUsd(quote.monthlyCents)}, a saving of ${formatUsd(quote.savingsCents)}.`
}

/** Riders eligible for a quote email right now. */
export function quoteEligible({ metrics, verifiedStudent, hasPlan, optedOut, alreadyQuoted }) {
  if (!verifiedStudent) return { ok: false, reason: 'not_verified_student' }
  if (hasPlan) return { ok: false, reason: 'has_plan' }
  if (optedOut) return { ok: false, reason: 'opted_out' }
  if (alreadyQuoted) return { ok: false, reason: 'already_quoted' }
  if ((metrics.totalCompleted || 0) < QUOTE_TRIGGER_RIDES) return { ok: false, reason: 'under_five_rides' }
  if ((metrics.historyDays || 0) < QUOTE_MIN_HISTORY_DAYS) return { ok: false, reason: 'under_14_days' }
  return { ok: true }
}

// ---------- verification ----------

export const CLEMSON_DOMAINS = ['clemson.edu', 'g.clemson.edu']

export function isClemsonStudentEmail(email) {
  const m = /^[^@\s]+@([^@\s]+)$/.exec(String(email || '').trim().toLowerCase())
  return Boolean(m && CLEMSON_DOMAINS.includes(m[1]))
}

/** Fall: Aug–Dec, Spring: Jan–May, Summer: Jun–Jul. */
export function termCode(at = new Date()) {
  const { year, month } = easternClock(at)
  if (month >= 8) return `${year}FA`
  if (month <= 5) return `${year}SP`
  return `${year}SU`
}

/** Verified for the current semester? Re-verify each term. */
export function enrollmentCurrent(enrollment, at = new Date()) {
  if (!enrollment?.email_verified_at) return false
  if (enrollment.status !== 'verified') return false
  return enrollment.term_code === termCode(at)
}

/** Days counted on the plan clock: calendar days since start minus paused days. */
export function activeClockDays(windowStart, pauses = [], now = new Date()) {
  if (!windowStart) return 0
  const start = new Date(windowStart).getTime()
  const total = Math.max(0, Math.floor((now.getTime() - start) / 86400000))
  let paused = 0
  for (const p of pauses) {
    if (p.canceled_at) continue
    const s = Math.max(start, Date.parse(p.start_date))
    const e = Math.min(now.getTime(), Date.parse(p.end_date) + 86400000)
    if (e > s) paused += Math.floor((e - s) / 86400000)
  }
  return Math.max(0, total - paused)
}

/** Stripe Price IDs come from env/config only. Never hard-coded. */
export function priceIdsFromEnv(env = {}) {
  const v = (k) => String(env[k] || '').trim() || null
  return {
    weekend_carpool: { month: v('STRIPE_PRICE_WEEKEND_CARPOOL_MONTHLY'), semester: v('STRIPE_PRICE_WEEKEND_CARPOOL_SEMESTER') },
    personalized: { product: v('STRIPE_PRODUCT_PERSONALIZED_PLAN') },
  }
}
