/**
 * Clemson student domain gate — optional student pricing when @clemson.edu.
 * Guest browse stays open.
 */
export function isClemsonEmail(email) {
  if (!email || typeof email !== 'string') return false
  return email.trim().toLowerCase().endsWith('@clemson.edu')
}
