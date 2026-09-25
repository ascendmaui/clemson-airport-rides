/**
 * Resolve hook for server/adminDesk.test.js.
 * Redirects only adminDesk.js imports of the live service clients.
 */

const redirects = {
  '../friendRideLib.js': new URL('./adminDeskFriendRideLib.js', import.meta.url).href,
  '../staffAccess.js': new URL('./adminDeskStaffAccess.js', import.meta.url).href,
  '../applicantMail.js': new URL('./adminDeskApplicantMail.js', import.meta.url).href,
}

export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL || ''
  const target = redirects[specifier]
  if (target && parent.includes('/server/endpoints/adminDesk.js')) {
    return { url: target, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
