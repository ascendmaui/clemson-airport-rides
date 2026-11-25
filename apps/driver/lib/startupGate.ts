/** First-paint budget for a signed-in Driver launch. Hung storage or network must not keep the splash up. */
export const STARTUP_TIMEOUT_MS = 8000

export const DRIVER_STATUS_TIMEOUT_COPY = 'Could not load driver status. Pull to refresh.'

export type StartupRace<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'timeout' | 'error' }

/**
 * Settles once. A hang or a rejection becomes a fallback the caller can render.
 * The original promise is left running so a late success can still be applied by the caller.
 */
export function raceWithTimeout<T>(work: Promise<T>, ms: number): Promise<StartupRace<T>> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: StartupRace<T>) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      finish({ ok: false, reason: 'timeout' })
    }, ms)
    work.then(
      (value) => finish({ ok: true, value }),
      () => finish({ ok: false, reason: 'error' }),
    )
  })
}

/** Clickwrap hang or failure shows the agreement, which is a screen, instead of the spinner. */
export function clickwrapPhaseAfterRace(result: StartupRace<'ok' | 'required'>): 'ok' | 'required' {
  if (result.ok) return result.value === 'ok' ? 'ok' : 'required'
  switch (result.reason) {
    case 'timeout':
    case 'error':
      return 'required'
    default: {
      const unexpected: never = result.reason
      return unexpected
    }
  }
}
