/**
 * Game-day experience for riders and drivers.
 * Schedule rows stay on game_day_events (rider fare). Optional feeds:
 * driver_perk_config.game_day_surge (driver zone bonus) and clemson_events
 * (campus calendar kickoff and driver bonus). Neither feed changes the
 * charged fare on its own. The charged rate matches resolveSurge in
 * src/lib/fareRates.js: 1.25x during a Clemson home-game window
 * (public.clemson_home_games, kickoff-4h..kickoff+3h) on trips to or from
 * the stadium area (~2 mi of the stadium pin), never stacked, capped at 1.25x.
 */
import { SURGE_CAP as PRICING_SURGE_CAP, activeHomeGame } from './gameDaySurge.js'

export const GAME_DAY_ORANGE = '#F56600'
export const GAME_DAY_PURPLE = '#522D80'
export const SURGE_CAP = PRICING_SURGE_CAP
/** Game-day rate (name kept for callers): 1.25x, John's 2026-10-17 decision. */
export const SATURDAY_GAME_DAY_MULTIPLIER = 1.25
export const EXPERIENCE_LEAD_MS = 7 * 24 * 3600 * 1000
export const POST_GAME_MS = 6 * 3600 * 1000
export const QUEUE_FRESH_MS = 6 * 3600 * 1000
export const SURGE_TIME_ZONE = 'America/New_York'

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

export const DEFAULT_ZONES = Object.freeze([
  {
    id: 'north-plaza',
    kind: 'pickup',
    name: 'North plaza',
    instructions: 'Walk to the north pedestrian plaza. Drivers stage on the outer curb, passenger side.',
    walk_minutes: 4,
    lat: 34.6812,
    lng: -82.8432,
    sort_order: 1,
  },
  {
    id: 'west-curb',
    kind: 'pickup',
    name: 'West curb',
    instructions: 'Outer row of the west lot. Stay off the fire lane and do not wait in a tunnel.',
    walk_minutes: 6,
    lat: 34.6788,
    lng: -82.8465,
    sort_order: 2,
  },
  {
    id: 'east-drop',
    kind: 'dropoff',
    name: 'East gate',
    instructions: 'Drop-off only. Drivers unload and leave with the lane. No waiting.',
    walk_minutes: 3,
    lat: 34.6786,
    lng: -82.8398,
    sort_order: 3,
  },
  {
    id: 'south-loop',
    kind: 'dropoff',
    name: 'South loop',
    instructions: 'One-way loop. Follow the posted arrows and exit with traffic.',
    walk_minutes: 5,
    lat: 34.6762,
    lng: -82.843,
    sort_order: 4,
  },
])

export const DEFAULT_WINDOWS = Object.freeze([
  {
    id: 'arrivals',
    label: 'Arrivals',
    offset_start_minutes: -180,
    offset_end_minutes: -60,
    heat: 'warm',
    note: 'Riders heading to the gates. Stage at the pickup curbs.',
    sort_order: 1,
  },
  {
    id: 'kickoff-rush',
    label: 'Kickoff rush',
    offset_start_minutes: -60,
    offset_end_minutes: -10,
    heat: 'peak',
    note: 'Shortest walks fill first. Drop-off lanes move one car at a time.',
    sort_order: 2,
  },
  {
    id: 'in-seats',
    label: 'In the seats',
    offset_start_minutes: -10,
    offset_end_minutes: 200,
    heat: 'warm',
    note: 'Quiet stretch. Keep the post-game curb clear.',
    sort_order: 3,
  },
  {
    id: 'final-whistle',
    label: 'Final whistle',
    offset_start_minutes: 200,
    offset_end_minutes: 260,
    heat: 'peak',
    note: 'Post-game pickup queue opens. North plaza and the west curb are hottest.',
    sort_order: 4,
  },
  {
    id: 'late-exits',
    label: 'Late exits',
    offset_start_minutes: 260,
    offset_end_minutes: 380,
    heat: 'hot',
    note: 'The line thins. Stay in the posted lane until the queue closes.',
    sort_order: 5,
  },
])

export const DEFAULT_PREP = Object.freeze([
  {
    id: 'charge',
    title: 'Charge the phone and the car',
    detail: 'A stadium shift runs through the late exits.',
    sort_order: 1,
  },
  {
    id: 'zones',
    title: 'Read the pickup and drop-off zones',
    detail: 'Stage on the outer curb. Do not block a fire lane or a tunnel.',
    sort_order: 2,
  },
  {
    id: 'surge',
    title: 'Check the fare multiplier',
    detail: 'The charged rate is on this screen before you go online.',
    sort_order: 3,
  },
  {
    id: 'queue',
    title: 'Plan for the post-game line',
    detail: 'The pickup queue opens after the game. Hot times are on the timeline.',
    sort_order: 4,
  },
  {
    id: 'traffic',
    title: 'Follow posted traffic control',
    detail: 'If an officer moves you off the pin, follow the officer.',
    sort_order: 5,
  },
])

const QUEUE_STATUSES = new Set(['forming', 'open', 'busy', 'paused', 'closed'])
const HEATS = new Set(['warm', 'hot', 'peak'])

export function formatMultiplier(value) {
  const raw = Number(value)
  if (!Number.isFinite(raw) || raw <= 0) return null
  const rounded = Math.round(raw * 100) / 100
  return `${rounded}×`
}

export function clampSurge(multiplier) {
  const m = Number(multiplier)
  if (!Number.isFinite(m) || m <= 0) return 1
  return Math.min(SURGE_CAP, Math.max(1, m))
}

export function zonedParts(date, timeZone = SURGE_TIME_ZONE) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]))
  return {
    weekday: WEEKDAY_INDEX[parts.weekday] ?? 0,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    month: Number(parts.month),
  }
}

/** Saturday 11:00–23:00 ET in Aug–Nov. Same window as the fare engine. */
/** True inside a Clemson home-game pricing window (name kept for callers; not every fall Saturday). */
export function saturdayGameDay(at = new Date()) {
  const when = at instanceof Date ? at : new Date(at)
  if (Number.isNaN(when.getTime())) return false
  return Boolean(activeHomeGame(when))
}

function parseTime(value) {
  const t = Date.parse(value)
  return Number.isFinite(t) ? t : null
}

function formatSpan(ms) {
  const totalMin = Math.max(0, Math.floor(Math.abs(ms) / 60000))
  const days = Math.floor(totalMin / (60 * 24))
  const hours = Math.floor((totalMin % (60 * 24)) / 60)
  const mins = totalMin % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

function formatClock(ms) {
  if (!Number.isFinite(ms)) return null
  return new Intl.DateTimeFormat('en-US', {
    timeZone: SURGE_TIME_ZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ms))
}

function formatClockShort(ms) {
  if (!Number.isFinite(ms)) return null
  return new Intl.DateTimeFormat('en-US', {
    timeZone: SURGE_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ms))
}

function moneyLabel(cents) {
  const n = Math.max(0, Math.round(Number(cents) || 0))
  if (!n) return null
  const dollars = n / 100
  const body = Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2)
  return `$${body}`
}

export function selectGameDayEvent(events, now = new Date(), { leadMs = EXPERIENCE_LEAD_MS, postMs = POST_GAME_MS } = {}) {
  const t = new Date(now).getTime()
  const rows = (events || []).filter((event) => {
    if (!event || event.active === false) return false
    return parseTime(event.starts_at) != null && parseTime(event.ends_at) != null
  })
  const live = rows.filter((event) => parseTime(event.starts_at) <= t && t <= parseTime(event.ends_at))
  if (live.length) {
    live.sort((a, b) => Number(b.surge_multiplier) - Number(a.surge_multiplier) || parseTime(a.starts_at) - parseTime(b.starts_at))
    return live[0]
  }
  const upcoming = rows
    .filter((event) => {
      const start = parseTime(event.starts_at)
      return start > t && start - t <= leadMs
    })
    .sort((a, b) => parseTime(a.starts_at) - parseTime(b.starts_at))
  if (upcoming.length) return upcoming[0]
  const recent = rows
    .filter((event) => {
      const end = parseTime(event.ends_at)
      return end < t && t - end <= postMs
    })
    .sort((a, b) => parseTime(b.ends_at) - parseTime(a.ends_at))
  return recent[0] || null
}

function noonOnDate(dateStr) {
  const match = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null
  const guess = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 16, 0, 0)
  const parts = zonedParts(new Date(guess))
  const deltaMin = (12 * 60) - parts.minutes
  return new Date(guess + deltaMin * 60000).toISOString()
}

function endOfDate(dateStr) {
  const noon = noonOnDate(dateStr)
  if (!noon) return null
  return new Date(Date.parse(noon) + 12 * 3600 * 1000).toISOString()
}

/** Campus-calendar rows become kickoff anchors. They do not set a fare. */
export function calendarAnchors(events) {
  const kinds = new Set(['football_home', 'big_event'])
  return (events || []).filter((event) => event && event.active !== false && kinds.has(event.kind)).map((event) => {
    const starts = event.starts_at || noonOnDate(event.event_date)
    const ends = event.ends_at || (event.ends_on ? endOfDate(event.ends_on) : (starts ? new Date(Date.parse(starts) + 4 * 3600 * 1000).toISOString() : null))
    return {
      ...event,
      starts_at: starts,
      ends_at: ends,
      surge_multiplier: null,
      source: 'calendar',
    }
  }).filter((event) => event.starts_at && event.ends_at)
}

export function kickoffPhase(event, now = new Date()) {
  if (!event) return 'off'
  const t = new Date(now).getTime()
  const start = parseTime(event.starts_at)
  const end = parseTime(event.ends_at)
  if (start == null || end == null) return 'off'
  if (t < start) return 'countdown'
  if (t <= end) return 'live'
  return 'postgame'
}

export function kickoffBanner(event, now = new Date()) {
  const phase = kickoffPhase(event, now)
  const start = event ? parseTime(event.starts_at) : null
  const end = event ? parseTime(event.ends_at) : null
  const t = new Date(now).getTime()
  const title = event?.title ? String(event.title) : 'Game day'
  if (phase === 'off') {
    return {
      phase,
      kicker: 'GAME DAY',
      title: 'No game on the board',
      countdownLabel: null,
      countdownCaption: 'The stadium guide stays here for the next kickoff.',
      kickoffLabel: null,
      live: false,
    }
  }
  if (phase === 'countdown') {
    return {
      phase,
      kicker: 'GAME DAY',
      title,
      countdownLabel: formatSpan(start - t),
      countdownCaption: 'Until kickoff',
      kickoffLabel: formatClock(start),
      live: false,
    }
  }
  if (phase === 'live') {
    return {
      phase,
      kicker: 'GAME DAY',
      title,
      countdownLabel: formatSpan(t - start),
      countdownCaption: 'Since kickoff',
      kickoffLabel: formatClock(start),
      live: true,
    }
  }
  return {
    phase,
    kicker: 'POST-GAME',
    title,
    countdownLabel: formatSpan(t - end),
    countdownCaption: 'Since the window closed',
    kickoffLabel: formatClock(start),
    live: false,
  }
}

function zoneRows(rows) {
  return (rows || [])
    .filter((zone) => zone && (zone.kind === 'pickup' || zone.kind === 'dropoff') && zone.name)
    .map((zone) => ({
      id: String(zone.id),
      kind: zone.kind,
      name: String(zone.name),
      instructions: zone.instructions ? String(zone.instructions) : '',
      walkMinutes: Number.isFinite(Number(zone.walk_minutes)) ? Number(zone.walk_minutes) : null,
      lat: Number.isFinite(Number(zone.lat)) ? Number(zone.lat) : null,
      lng: Number.isFinite(Number(zone.lng)) ? Number(zone.lng) : null,
      sortOrder: Number(zone.sort_order) || 0,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
}

export function zoneGuide(rows) {
  const list = zoneRows(rows && rows.length ? rows : DEFAULT_ZONES)
  return {
    headline: 'Stadium zones',
    body: 'Pickup curbs and drop-off loops. Follow posted traffic control if it differs from this guide.',
    pickups: list.filter((zone) => zone.kind === 'pickup'),
    dropoffs: list.filter((zone) => zone.kind === 'dropoff'),
  }
}

function relevantZones(rows, eventId) {
  const list = (rows || []).filter((zone) => zone && zone.active !== false)
  if (!list.length) return null
  return list.filter((zone) => !zone.event_id || zone.event_id === eventId)
}

export function deriveQueueStatus({ ridersWaiting = 0, driversStaged = 0 } = {}) {
  const riders = Math.max(0, Math.round(Number(ridersWaiting) || 0))
  const drivers = Math.max(0, Math.round(Number(driversStaged) || 0))
  if (riders === 0 && drivers === 0) return 'forming'
  if (drivers === 0 || riders / Math.max(drivers, 1) >= 3) return 'busy'
  return 'open'
}

export function estimateWaitMinutes(ridersWaiting, driversStaged) {
  const riders = Math.max(0, Math.round(Number(ridersWaiting) || 0))
  if (riders <= 0) return 0
  const cars = Math.max(1, Math.round(Number(driversStaged) || 0))
  return Math.min(90, Math.max(4, Math.ceil((riders / cars) * 6)))
}

function queueCopy(status, { riders, drivers, wait }) {
  switch (status) {
    case 'forming':
      return {
        headline: 'Post-game pickup queue is forming',
        detail: 'Counts appear as riders and drivers reach the stadium.',
      }
    case 'open':
      return {
        headline: 'Pickup queue is open',
        detail: `${riders} waiting · ${drivers} staged · about ${wait} min`,
      }
    case 'busy':
      return {
        headline: 'Pickup queue is long',
        detail: drivers === 0
          ? `${riders} waiting · cars are still staging`
          : `${riders} waiting · ${drivers} staged · about ${wait} min`,
      }
    case 'paused':
      return {
        headline: 'Pickup queue is paused',
        detail: 'Staging is held. Check back before you walk to the curb.',
      }
    case 'closed':
      return {
        headline: 'Post-game pickup opens after the game',
        detail: 'The queue stays closed until the window ends.',
      }
    default: {
      const unknown = status
      throw new Error(`Unknown pickup queue status: ${unknown}`)
    }
  }
}

export function postGameQueue({ phase, snapshot, now = new Date() } = {}) {
  if (phase === 'off') {
    return { visible: false, status: 'closed', headline: '', detail: '', waitLabel: null, ridersWaiting: 0, driversStaged: 0 }
  }
  if (phase === 'countdown' || phase === 'live') {
    const copy = queueCopy('closed', { riders: 0, drivers: 0, wait: 0 })
    return { visible: true, status: 'closed', ...copy, waitLabel: null, ridersWaiting: 0, driversStaged: 0 }
  }
  const updated = snapshot ? parseTime(snapshot.updated_at) : null
  const fresh = updated != null && new Date(now).getTime() - updated <= QUEUE_FRESH_MS && QUEUE_STATUSES.has(snapshot.status)
  const riders = fresh ? Math.max(0, Math.round(Number(snapshot.riders_waiting) || 0)) : 0
  const drivers = fresh ? Math.max(0, Math.round(Number(snapshot.drivers_staged) || 0)) : 0
  const status = fresh ? snapshot.status : 'forming'
  const wait = fresh && snapshot.wait_minutes != null && Number.isFinite(Number(snapshot.wait_minutes))
    ? Math.max(0, Math.round(Number(snapshot.wait_minutes)))
    : estimateWaitMinutes(riders, drivers)
  const copy = queueCopy(status, { riders, drivers, wait })
  const note = fresh && snapshot.note ? String(snapshot.note) : null
  return {
    visible: true,
    status,
    headline: copy.headline,
    detail: note || copy.detail,
    waitLabel: status === 'open' || status === 'busy' ? `${wait} min` : null,
    ridersWaiting: riders,
    driversStaged: drivers,
  }
}

function eventLiveAt(event, atMs) {
  if (!event || event.source === 'calendar') return false
  const start = parseTime(event.starts_at)
  const end = parseTime(event.ends_at)
  if (start == null || end == null) return false
  return start <= atMs && atMs <= end
}

/** Charged game-day multiplier at `at`, before the 1.25 cap. */
export function rawGameDayMultiplier(event, at = new Date()) {
  const when = at instanceof Date ? at : new Date(at)
  const eventMul = eventLiveAt(event, when.getTime()) ? Number(event.surge_multiplier) : 1
  const saturdayMul = saturdayGameDay(when) ? SATURDAY_GAME_DAY_MULTIPLIER : 1
  const eventOk = Number.isFinite(eventMul) && eventMul > 1 ? eventMul : 1
  return Math.max(eventOk, saturdayMul)
}

export function surgeTransparency({ event, now = new Date(), driverBonus = null, calendarBonus = null, zoneBoost = 0, phase = 'off' } = {}) {
  const when = now instanceof Date ? now : new Date(now)
  const raw = rawGameDayMultiplier(event, when)
  const charged = clampSurge(raw)
  const capped = raw > SURGE_CAP
  const eventOn = eventLiveAt(event, when.getTime()) && Number(event?.surge_multiplier) > 1
  const saturdayOn = saturdayGameDay(when)
  let source = 'none'
  if (eventOn && (!saturdayOn || Number(event.surge_multiplier) >= SATURDAY_GAME_DAY_MULTIPLIER)) source = 'event'
  else if (saturdayOn) source = 'saturday'
  else if (eventOn) source = 'event'

  const kickoffMs = event ? parseTime(event.starts_at) : null
  const upcomingRaw = phase === 'countdown' && kickoffMs != null ? rawGameDayMultiplier(event, kickoffMs) : null
  const upcoming = upcomingRaw != null ? clampSurge(upcomingRaw) : null
  const upcomingDiffers = upcoming != null && upcoming !== charged

  const reasons = []
  if (source === 'event') {
    reasons.push(`This game sets the fare at ${formatMultiplier(event.surge_multiplier)} from kickoff through the scheduled window.`)
  }
  if (source === 'saturday' && eventOn) {
    reasons.push(`The scheduled game is ${formatMultiplier(event.surge_multiplier)}. The home-game window is ${formatMultiplier(SATURDAY_GAME_DAY_MULTIPLIER)}. The higher rate is charged, up to ${formatMultiplier(SURGE_CAP)}.`)
  } else if (source === 'saturday') {
    reasons.push(`Clemson home-game window: trips to or from the stadium area use the published ${formatMultiplier(SATURDAY_GAME_DAY_MULTIPLIER)} game-day rate, 4 hours before kickoff to 3 hours after.`)
  }
  if (source === 'none' && !upcomingDiffers) {
    reasons.push('No game-day multiplier is on. The fare is the standard rate.')
  }
  if (capped) reasons.push(`The published cap holds the charged fare at ${formatMultiplier(SURGE_CAP)}.`)
  if (event?.pickup_zone_label) reasons.push(`Stadium pickup on the schedule: ${event.pickup_zone_label}.`)
  if (upcomingDiffers) reasons.push(`At kickoff the fare moves to ${formatMultiplier(upcoming)}.`)
  if (driverBonus?.label) reasons.push(`${driverBonus.label} while the zone is live.`)
  if (calendarBonus?.label) reasons.push(`Calendar bonus ${calendarBonus.label}.`)
  if (Number(zoneBoost) > 0 && phase === 'live') {
    reasons.push('Drivers staged near the stadium are favored for matching while the zone is live.')
  }

  const multiplierLabel = formatMultiplier(charged)
  let headline = 'Standard fare'
  if (charged > 1) headline = `${multiplierLabel} fare`
  else if (upcomingDiffers) headline = 'Standard fare until kickoff'

  const riderLine = charged > 1
    ? `Game-day pricing: ${multiplierLabel} the usual fare on trips to or from the stadium area while this window is on. Drivers see this same rate before they go online.`
    : upcomingDiffers
      ? `You pay the standard fare until kickoff, then ${formatMultiplier(upcoming)}.`
      : 'You pay the standard fare. A game-day rate shows here before you request a ride.'

  const driverLine = charged > 1
    ? `Before you go online: riders near the stadium pay ${multiplierLabel}. Your share stays 80% of that fare.`
    : upcomingDiffers
      ? `Before you go online: riders pay the standard fare until kickoff, then ${formatMultiplier(upcoming)}.`
      : 'Before you go online: no game-day multiplier. Riders pay the standard fare.'

  return {
    source,
    multiplier: charged,
    multiplierLabel,
    upcomingLabel: upcomingDiffers ? formatMultiplier(upcoming) : null,
    capped,
    headline,
    reasons,
    riderLine,
    driverLine,
    disclosed: true,
    driverBonusLabel: driverBonus?.label || null,
    calendarBonusLabel: calendarBonus?.label || null,
  }
}

export function prepChecklist(items, checkedIds = []) {
  const source = items && items.length ? items : DEFAULT_PREP
  const checked = new Set((checkedIds || []).map((id) => String(id)))
  const rows = source
    .filter((item) => item && item.id && item.title)
    .map((item) => ({
      id: String(item.id),
      title: String(item.title),
      detail: item.detail ? String(item.detail) : '',
      sortOrder: Number(item.sort_order) || 0,
      checked: checked.has(String(item.id)),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))
  const done = rows.filter((item) => item.checked).length
  return {
    headline: 'Game-day prep',
    progressLabel: `${done} of ${rows.length} ready`,
    done,
    total: rows.length,
    items: rows,
  }
}

function heatLabel(heat) {
  switch (heat) {
    case 'warm':
      return 'Warm'
    case 'hot':
      return 'Hot'
    case 'peak':
      return 'Peak'
    default: {
      const unknown = heat
      throw new Error(`Unknown zone heat: ${unknown}`)
    }
  }
}

export function zoneHotTimeline(windows, kickoffAt, now = new Date()) {
  const source = (windows && windows.length ? windows : DEFAULT_WINDOWS).filter((row) => row && HEATS.has(row.heat) && row.label)
  const kickoff = parseTime(kickoffAt)
  const t = new Date(now).getTime()
  const rows = source
    .map((row) => {
      const startOff = Number(row.offset_start_minutes)
      const endOff = Number(row.offset_end_minutes)
      const startMs = kickoff == null ? null : kickoff + startOff * 60000
      const endMs = kickoff == null ? null : kickoff + endOff * 60000
      let state = 'later'
      if (startMs != null && endMs != null) {
        if (t >= endMs) state = 'past'
        else if (t >= startMs) state = 'now'
        else state = 'later'
      }
      const whenLabel = startMs != null && endMs != null
        ? `${formatClockShort(startMs)}–${formatClockShort(endMs)}`
        : relativeWindow(startOff, endOff)
      return {
        id: String(row.id),
        label: String(row.label),
        heat: row.heat,
        heatLabel: heatLabel(row.heat),
        note: row.note ? String(row.note) : '',
        whenLabel,
        state,
        sortOrder: Number(row.sort_order) || startOff || 0,
      }
    })
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const current = rows.find((row) => row.state === 'now')
  const next = rows.find((row) => row.state === 'later')
  if (next && !current) next.state = 'next'
  return {
    headline: 'Zone hot times',
    body: kickoff == null
      ? 'Times are relative to kickoff until a game is on the board.'
      : 'Hot times follow kickoff. The charged fare is the multiplier above, not a second rate.',
    windows: rows,
  }
}

function relativeWindow(startOff, endOff) {
  const side = (mins) => {
    const abs = Math.abs(mins)
    const hours = Math.floor(abs / 60)
    const rest = abs % 60
    const body = hours ? `${hours}h${rest ? ` ${rest}m` : ''}` : `${rest}m`
    if (mins < 0) return `${body} before`
    if (mins > 0) return `${body} after`
    return 'kickoff'
  }
  return `${side(startOff)} → ${side(endOff)}`
}

export function readDriverBonus(config, phase) {
  if (!config || config.enabled === false) return null
  if (phase !== 'live') return null
  const cents = Math.max(0, Math.round(Number(config.driverBonusCents) || 0))
  const label = moneyLabel(cents)
  if (!label) return null
  return { cents, label: `${label} per completed stadium trip` }
}

export function readCalendarBonus(events, now = new Date()) {
  const t = new Date(now).getTime()
  for (const event of events || []) {
    if (!event || event.active === false) continue
    const cents = Math.max(0, Math.round(Number(event.driver_bonus_cents) || 0))
    const start = parseTime(event.bonus_starts_at)
    const end = parseTime(event.bonus_ends_at)
    if (!cents || start == null || end == null || t < start || t >= end) continue
    return { cents, label: `${moneyLabel(cents)} per completed trip` }
  }
  return null
}

export function buildGameDayExperience({
  now = new Date(),
  events = [],
  calendarEvents = [],
  zones = null,
  windows = null,
  prepItems = null,
  checkedIds = [],
  queue = null,
  surgeConfig = null,
} = {}) {
  const when = now instanceof Date ? now : new Date(now)
  const scheduled = selectGameDayEvent(events, when)
  const calendar = scheduled ? null : selectGameDayEvent(calendarAnchors(calendarEvents), when)
  const event = scheduled
    ? { ...scheduled, source: 'game_day' }
    : (calendar ? { ...calendar, source: 'calendar' } : null)
  const phase = kickoffPhase(event, when)
  const banner = kickoffBanner(event, when)
  const zoneList = relevantZones(zones, event?.source === 'game_day' ? event.id : null)
  const guide = zoneGuide(zoneList && zoneList.length ? zoneList : null)
  const pickupQueue = postGameQueue({ phase, snapshot: queue, now: when })
  const onSchedule = event?.source === 'game_day'
  const driverBonus = onSchedule ? readDriverBonus(surgeConfig, phase) : null
  const calendarBonus = readCalendarBonus(calendarEvents, when)
  const zoneBoost = onSchedule && surgeConfig && surgeConfig.enabled !== false ? Number(surgeConfig.zoneBoost) || 0 : 0
  const fareEvent = event
    ? { ...event, surge_multiplier: onSchedule ? event.surge_multiplier : null }
    : null
  const surge = surgeTransparency({
    event: fareEvent,
    now: when,
    driverBonus,
    calendarBonus,
    zoneBoost,
    phase,
  })
  const prep = prepChecklist(prepItems, checkedIds)
  const timeline = zoneHotTimeline(windows, event ? event.starts_at : null, when)
  return {
    palette: { orange: GAME_DAY_ORANGE, purple: GAME_DAY_PURPLE },
    phase,
    eventId: event?.source === 'game_day' ? event.id : null,
    eventTitle: banner.title,
    banner,
    zones: guide,
    queue: pickupQueue,
    surge,
    prep,
    timeline,
  }
}
