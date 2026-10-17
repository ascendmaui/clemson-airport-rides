/**
 * Tablet ad rotation. Pure functions shared by the server feed, the tablet player and tests.
 * Weight = placement weight x package frequency x (game-day boost on game days).
 * first_in_loop items lead every loop; takeover items dominate on game days.
 */
import { saturdayGameDay } from '../gameDayExperience.js'

export const PLACEMENT_WEIGHT = { standard: 1, first_in_loop: 2, takeover: 4 }
export const MAX_LOOP = 60

const ms = (v) => {
  if (v == null || v === '') return null
  const t = v instanceof Date ? v.getTime() : Date.parse(v)
  return Number.isFinite(t) ? t : null
}

/** Why a campaign cannot play right now, or null when it can. */
export function campaignBlockReason(campaign, now = new Date()) {
  if (!campaign) return 'missing'
  if (campaign.status !== 'active') return `status_${campaign.status || 'unknown'}`
  const t = now instanceof Date ? now.getTime() : Date.parse(now)
  const start = ms(campaign.starts_at)
  const end = ms(campaign.ends_at)
  if (start != null && start > t) return 'not_started'
  if (end != null && end <= t) return 'ended_date'
  const bought = campaign.rides_purchased
  if (bought != null && Number(campaign.rides_served || 0) >= Number(bought)) return 'rides_reached'
  return null
}

export function campaignPlayable(campaign, now = new Date()) {
  return campaignBlockReason(campaign, now) === null
}

/** Campaigns that should flip to ended (date passed or rides used up). */
export function campaignsToEnd(campaigns = [], now = new Date()) {
  return campaigns
    .filter((c) => c?.status === 'active')
    .map((c) => ({ id: c.id, reason: campaignBlockReason(c, now) }))
    .filter((x) => x.reason === 'ended_date' || x.reason === 'rides_reached')
}

export function isGameDay(now = new Date(), override = null) {
  if (override === true || override === false) return override
  return saturdayGameDay(now)
}

export function adWeight(pkg = {}, { gameDay = false } = {}) {
  const placement = PLACEMENT_WEIGHT[pkg.placement] ? pkg.placement : 'standard'
  const frequency = Math.max(1, Math.min(20, Math.round(Number(pkg.frequency) || 1)))
  const boost = gameDay ? Math.max(1, Math.min(10, Number(pkg.game_day_boost) || 1)) : 1
  const base = placement === 'takeover' && !gameDay ? PLACEMENT_WEIGHT.standard : PLACEMENT_WEIGHT[placement]
  return Math.max(1, Math.round(base * frequency * boost))
}

/**
 * Build one loop of slots from playable items.
 * item: { id, campaign, creative, pkg } -> slot: { ...item, seconds, weight }
 * Smooth weighted round-robin keeps heavy ads spread out instead of back to back.
 */
export function buildLoop(items = [], { now = new Date(), gameDay = isGameDay(now), maxSlots = MAX_LOOP } = {}) {
  const playable = items.filter((it) => it?.creative?.approval_status === 'approved' && campaignPlayable(it.campaign, now))
  if (!playable.length) return []
  const weighted = playable.map((it) => ({
    ...it,
    weight: adWeight(it.pkg, { gameDay }),
    seconds: Math.max(3, Math.min(120, Number(it.pkg?.slot_seconds) || 10)),
  }))
  const leaders = weighted.filter((it) => it.pkg?.placement === 'first_in_loop')
  const total = weighted.reduce((sum, it) => sum + it.weight, 0)
  const length = Math.min(maxSlots, Math.max(total, leaders.length))
  const current = new Map(weighted.map((it) => [it.id, 0]))
  const loop = []
  for (const lead of leaders) loop.push(lead)
  const leadUsed = new Map(leaders.map((it) => [it.id, 1]))
  while (loop.length < length) {
    let best = null
    for (const it of weighted) {
      const next = current.get(it.id) + it.weight
      current.set(it.id, next)
      if (!best || next > current.get(best.id)) best = it
    }
    current.set(best.id, current.get(best.id) - total)
    const credit = leadUsed.get(best.id) || 0
    if (credit > 0) { leadUsed.set(best.id, credit - 1); continue }
    loop.push(best)
  }
  return loop
}
