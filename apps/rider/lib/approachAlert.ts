/** Live driver-approach distance and attention cues for the rider app. */

export const APPROACH_STATUSES = ['accepted', 'arriving', 'arrived'] as const

/** Feet of closing that count as "getting closer" rather than GPS jitter. */
export const APPROACH_DECREASE_FT = 25

export const APPROACH_NEAR_FT = 500
export const APPROACH_CLOSE_FT = 200
export const APPROACH_HERE_FT = 100

const FEET_PER_METER = 3.280839895013123

export type ApproachStatus = (typeof APPROACH_STATUSES)[number]
export type ApproachStage = 'far' | 'near' | 'close' | 'here'
export type ApproachHapticLevel = 'light' | 'medium' | 'heavy'
export type ApproachPulseMode = 'off' | 'burst' | 'steady'

export type ApproachReading = {
  feet: number
  meters: number
  primary: string
  secondary: string
}

export type ApproachAttention = {
  stage: ApproachStage
  decreasing: boolean
  pulseMode: ApproachPulseMode
  washPeak: number
  brightPeak: number
  haptic: ApproachHapticLevel | null
  hapticReason: 'stage' | 'closing' | null
}

export function isApproachStatus(status: string | null | undefined): status is ApproachStatus {
  return (APPROACH_STATUSES as readonly string[]).includes(String(status || ''))
}

export function metersToFeet(meters: number) {
  return meters * FEET_PER_METER
}

function wholeApproachFeet(feet: number | null | undefined): number | null {
  if (typeof feet !== 'number' || !Number.isFinite(feet) || feet < 0) return null
  return Math.round(feet)
}

/** Human foot label. Null, NaN, Infinity, and negative distances say "nearby". */
export function formatApproachFeet(feet: number | null | undefined): string {
  const whole = wholeApproachFeet(feet)
  if (whole == null) return 'nearby'
  return `${whole.toLocaleString('en-US')} ft`
}

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number | null {
  if (![lat1, lng1, lat2, lng2].every((value) => Number.isFinite(value))) return null
  const earth = 6371000
  const toRad = (degrees: number) => (degrees * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function formatApproachDistance(meters: number | null): ApproachReading | null {
  if (meters == null || !Number.isFinite(meters) || meters < 0) return null
  const feet = Math.max(0, Math.round(metersToFeet(meters)))
  const wholeMeters = Math.max(0, Math.round(meters))
  return {
    feet,
    meters: wholeMeters,
    primary: `Driver ${formatApproachFeet(feet)} away`,
    secondary: `${wholeMeters.toLocaleString('en-US')} m`,
  }
}

/**
 * Inclusive whole-foot cuts, same result for the same displayed foot every time:
 * here <= 100, close <= 200, near <= 500, otherwise far.
 * Fractional feet round first so 100.4 (shown as 100) stays here and 500.4 stays near.
 */
export function approachStage(feet: number | null | undefined): ApproachStage | null {
  const whole = wholeApproachFeet(feet)
  if (whole == null) return null
  if (whole <= APPROACH_HERE_FT) return 'here'
  if (whole <= APPROACH_CLOSE_FT) return 'close'
  if (whole <= APPROACH_NEAR_FT) return 'near'
  return 'far'
}

function stageRank(stage: ApproachStage) {
  switch (stage) {
    case 'far':
      return 0
    case 'near':
      return 1
    case 'close':
      return 2
    case 'here':
      return 3
    default: {
      const neverStage: never = stage
      return neverStage
    }
  }
}

function peaks(stage: ApproachStage, mode: 'steady' | 'burst') {
  if (mode === 'burst') return { washPeak: 0.18, brightPeak: 0.1 }
  switch (stage) {
    case 'here':
      return { washPeak: 0.4, brightPeak: 0.24 }
    case 'close':
      return { washPeak: 0.32, brightPeak: 0.18 }
    case 'near':
      return { washPeak: 0.24, brightPeak: 0.12 }
    case 'far':
      return { washPeak: 0.18, brightPeak: 0.1 }
    default: {
      const neverStage: never = stage
      return neverStage
    }
  }
}

function stageHaptic(stage: ApproachStage): ApproachHapticLevel {
  switch (stage) {
    case 'here':
      return 'heavy'
    case 'close':
      return 'medium'
    case 'near':
    case 'far':
      return 'light'
    default: {
      const neverStage: never = stage
      return neverStage
    }
  }
}

function outwardHoldFeet(stage: ApproachStage): number {
  switch (stage) {
    case 'here':
      return APPROACH_HERE_FT
    case 'close':
      return APPROACH_CLOSE_FT
    case 'near':
      return APPROACH_NEAR_FT
    case 'far':
      return Number.POSITIVE_INFINITY
    default: {
      const neverStage: never = stage
      return neverStage
    }
  }
}

/**
 * Pulse while the driver is inside 500 / 200 / 100 ft.
 * Outside that, a short burst only when the distance drops by APPROACH_DECREASE_FT.
 * Peaks stay under half opacity and the UI pulses slower than 1 Hz.
 * Pass previousStage to keep a closer stage until the driver is more than
 * APPROACH_DECREASE_FT past that boundary. Inward crossings still update immediately.
 */
export function approachAttention(input: {
  previousFeet: number | null
  feet: number | null
  previousStage?: ApproachStage | null
}): ApproachAttention | null {
  const feet = wholeApproachFeet(input.feet)
  if (feet == null) return null
  const raw = approachStage(feet)
  if (!raw) return null
  const previousFeet = input.previousFeet != null
    && Number.isFinite(input.previousFeet)
    && input.previousFeet >= 0
    ? Math.round(input.previousFeet)
    : null
  const derivedPrevious = previousFeet == null ? null : approachStage(previousFeet)
  const hasLatch = input.previousStage !== undefined
  const latched = hasLatch ? input.previousStage ?? null : derivedPrevious
  let stage = raw
  if (
    hasLatch
    && latched
    && stageRank(raw) < stageRank(latched)
    && feet <= outwardHoldFeet(latched) + APPROACH_DECREASE_FT
  ) {
    stage = latched
  }
  const decreasing = previousFeet != null && previousFeet - feet >= APPROACH_DECREASE_FT
  const entered = latched == null ? stage !== 'far' : stageRank(stage) > stageRank(latched)
  const pulseMode: ApproachPulseMode = stage === 'far' ? (decreasing ? 'burst' : 'off') : 'steady'
  const { washPeak, brightPeak } = peaks(stage, pulseMode === 'burst' ? 'burst' : 'steady')
  let haptic: ApproachHapticLevel | null = null
  let hapticReason: ApproachAttention['hapticReason'] = null
  if (entered) {
    haptic = stageHaptic(stage)
    hapticReason = 'stage'
  } else if (decreasing) {
    haptic = stage === 'here' || stage === 'close' ? 'medium' : 'light'
    hapticReason = 'closing'
  }
  return { stage, decreasing, pulseMode, washPeak, brightPeak, haptic, hapticReason }
}

function approachPhrase(stage: ApproachStage | null, decreasing: boolean): string {
  if (stage == null) return 'Locating'
  if (decreasing && stage !== 'here') return 'Getting closer'
  switch (stage) {
    case 'here':
      return 'Right here'
    case 'close':
      return 'Very close'
    case 'near':
      return 'Nearby'
    case 'far':
      return 'On the way'
    default: {
      const neverStage: never = stage
      return neverStage
    }
  }
}

export function approachStatusLine(
  stage: ApproachStage | null,
  decreasing: boolean,
  feet?: number | null,
) {
  const phrase = approachPhrase(stage, decreasing)
  const distance = formatApproachFeet(feet)
  if (distance === 'nearby' && phrase.toLowerCase().includes('nearby')) return phrase
  return `${phrase} · ${distance}`
}
