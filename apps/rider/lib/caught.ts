import { showToast } from 'rides-native/toastStore.js'

/** Message safe to show. Blank errors fall back to the sentence for that step. */
export function caughtMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message
  if (typeof err === 'string' && err.trim()) return err.trim()
  return fallback
}

/** Record a failure. There is no Sentry client in this app; the console is the logger. */
export function logCaught(scope: string, err: unknown): void {
  const detail = err instanceof Error ? err.message : err
  console.warn(`[rider] ${scope}`, detail)
}

/**
 * Log a failure the rider can act on, and show it in the shared toast.
 * Background work that retries should call logCaught instead.
 */
export function toastCaught(scope: string, err: unknown, title: string, body?: string): void {
  logCaught(scope, err)
  const message = body ?? caughtMessage(err, '')
  showToast({
    key: `rider:${scope}`,
    tone: 'error',
    title,
    body: message || null,
  })
}
