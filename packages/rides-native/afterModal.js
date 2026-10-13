/**
 * Queue work until a React Native modal has closed.
 * Pushing a screen while a modal is still dismissing crashes UIKit,
 * especially under iOS 26 native tabs.
 */

export function createModalGate() {
  let open = 0
  const waiters = []
  return {
    opened() { open += 1 },
    closed() {
      open = Math.max(0, open - 1)
      if (open > 0) return
      const jobs = waiters.splice(0, waiters.length)
      for (const job of jobs) job()
    },
    isOpen() { return open > 0 },
    afterClose(job) {
      if (typeof job !== 'function') return
      if (open === 0) job()
      else waiters.push(job)
    },
  }
}
