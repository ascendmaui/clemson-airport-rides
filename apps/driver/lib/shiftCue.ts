/** GO and END feedback. Accept and trip-complete keep their own cues. */
export type ShiftControl = 'GO' | 'END'

export type ShiftSound = 'go' | 'end'

export type ShiftHaptic =
  | { atMs: number; kind: 'impact'; style: 'heavy' | 'light' }
  | { atMs: number; kind: 'success' }

export type ShiftCue = {
  sound: ShiftSound
  haptics: readonly ShiftHaptic[]
}

/** GO rises: one heavy impact, then two successes close together. */
const GO_HAPTICS: readonly ShiftHaptic[] = [
  { atMs: 0, kind: 'impact', style: 'heavy' },
  { atMs: 100, kind: 'success' },
  { atMs: 200, kind: 'success' },
]

/** END is gentle: two light impacts with a gap between them. */
const END_HAPTICS: readonly ShiftHaptic[] = [
  { atMs: 0, kind: 'impact', style: 'light' },
  { atMs: 320, kind: 'impact', style: 'light' },
]

export function shiftCue(control: ShiftControl): ShiftCue {
  switch (control) {
    case 'GO':
      return { sound: 'go', haptics: GO_HAPTICS }
    case 'END':
      return { sound: 'end', haptics: END_HAPTICS }
    default: {
      const unknown: never = control
      return unknown
    }
  }
}

export type ShiftIo = {
  sounds: boolean
  play: (sound: ShiftSound) => void
  impact: (style: 'heavy' | 'light') => void
  success: () => void
  delay: (ms: number) => Promise<void>
}

/** Plays the shift sound (when sounds are on) and fires its haptic sequence. */
export async function playShiftCue(control: ShiftControl, io: ShiftIo): Promise<void> {
  const cue = shiftCue(control)
  if (io.sounds) io.play(cue.sound)
  let elapsed = 0
  for (const step of cue.haptics) {
    const wait = step.atMs - elapsed
    if (wait > 0) await io.delay(wait)
    elapsed = step.atMs
    switch (step.kind) {
      case 'impact':
        io.impact(step.style)
        break
      case 'success':
        io.success()
        break
      default: {
        const unknown: never = step
        return unknown
      }
    }
  }
}
