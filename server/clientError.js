/**
 * Text that is safe to put in a JSON error field.
 * Stacks, schema details, and secrets stay in the server log.
 */
const LEAK = /schema cache|does not exist|in column |violates |duplicate key|postgres|syntax error|stack trace|\bat\s+\S+\s+\(|node:internal|node_modules|\.js:\d+|service_role|\bsk_(?:live|test)_|\bwhsec_|bearer\s+\S|ECONN|ETIMEDOUT|ENOTFOUND|fetch failed/i

export function clientErrorMessage(error, fallback = 'Something went wrong') {
  const raw = typeof error === 'string'
    ? error
    : (error && typeof error.message === 'string' ? error.message : '')
  const line = raw.split('\n')[0].trim()
  if (!line || line.length > 180) return fallback
  if (LEAK.test(raw)) return fallback
  return line
}
