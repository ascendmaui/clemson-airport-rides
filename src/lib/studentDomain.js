/**
 * Optional Clemson student discount / verification helper.
 * NOT a signup or book/pay gate — any email may join.
 */
export function isClemsonEmail(email) {
  if (!email || typeof email !== 'string') return false
  return email.trim().toLowerCase().endsWith('@clemson.edu')
}
