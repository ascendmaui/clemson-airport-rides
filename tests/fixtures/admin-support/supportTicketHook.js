/**
 * Resolve hook for server/supportTicket.test.js.
 * Redirects only supportTicket.js imports of the live service clients.
 */

const redirects = {
  '../supabaseAdmin.js': new URL('./supportTicketSupabaseAdmin.js', import.meta.url).href,
  '../agentHttp.js': new URL('./supportTicketAgentHttp.js', import.meta.url).href,
  '../staffAccess.js': new URL('./supportTicketStaffAccess.js', import.meta.url).href,
  '../userContext.js': new URL('./supportTicketUserContext.js', import.meta.url).href,
  '../applySupportBot.js': new URL('./supportTicketApplySupportBot.js', import.meta.url).href,
}

export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL || ''
  const target = redirects[specifier]
  if (target && parent.includes('/server/endpoints/supportTicket.js')) {
    return { url: target, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
