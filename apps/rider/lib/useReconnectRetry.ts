import { useEffect, useRef } from 'react'
import { registerReconnectJob } from '@/lib/reconnectRetry'

/** Re-run `run` when the link returns. `enabled` drops the job while the action is healthy. */
export function useReconnectRetry(id: string, run: () => void | Promise<unknown>, enabled = true): void {
  const runRef = useRef(run)
  runRef.current = run
  useEffect(() => {
    if (!enabled) return undefined
    return registerReconnectJob(id, () => runRef.current())
  }, [id, enabled])
}
