/**
 * Clemson student domain gate — optional student pricing when @clemson.edu.
 * Guest browse stays open.
 */
export function isClemsonEmail(email) {
  if (!email || typeof email !== 'string') return false
  const value = email.trim().toLowerCase()
  // @g.clemson.edu does not end with the characters "@clemson.edu".
  return value.endsWith('@clemson.edu') || value.endsWith('@g.clemson.edu')
}
