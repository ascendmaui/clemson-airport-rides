import { useCallback, useSyncExternalStore } from 'react'
import { secondClock } from './sharedClock'

const idle = () => () => {}

/** Current time from the shared 1s clock. Pass false to stop ticking (for example, dashcam not recording). */
export function useSecondClock(enabled = true): number {
  const subscribe = useCallback((listener: () => void) => (enabled ? secondClock.subscribe(listener) : idle()), [enabled])
  return useSyncExternalStore(subscribe, secondClock.now, secondClock.now)
}
