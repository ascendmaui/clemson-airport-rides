/**
 * Screens register a refresh. When the network returns, each one runs once.
 * Failed reads retry on their own; a ride request is not submitted from here.
 */

type Job = () => void | Promise<unknown>

let offline = false
const jobs = new Map<string, Job>()
const listeners = new Set<() => void>()

export function readOffline(): boolean {
  return offline
}

export function subscribeNetwork(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function emit(): void {
  for (const listener of listeners) listener()
}

async function runJobs(): Promise<void> {
  const pending = [...jobs.entries()]
  await Promise.all(pending.map(async ([id, job]) => {
    try {
      await job()
    } catch (err) {
      console.warn('[rider] reconnect retry', id, err instanceof Error ? err.message : err)
    }
  }))
}

/** NetInfo (or a test) reports the current link. Retries run only on the rising edge. */
export function reportNetwork(nextOffline: boolean): void {
  const regained = offline && !nextOffline
  if (offline === nextOffline) return
  offline = nextOffline
  emit()
  if (regained) void runJobs()
}

export function registerReconnectJob(id: string, job: Job): () => void {
  jobs.set(id, job)
  return () => {
    if (jobs.get(id) === job) jobs.delete(id)
  }
}

export function resetReconnectForTests(): void {
  offline = false
  jobs.clear()
  listeners.clear()
}
