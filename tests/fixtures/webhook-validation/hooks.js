/**
 * Resolve hook for api/stripeWebhookValidation.test.js.
 * A cache-busted stripe-webhook instance (URL query instance=routing) receives
 * the fake Supabase client. Every other importer keeps the real package.
 */
const fakeSupabase = new URL('./fakeSupabase.js', import.meta.url).href

export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL || ''
  if (specifier === '@supabase/supabase-js' && parent.includes('stripe-webhook.js?instance=routing')) {
    return { url: fakeSupabase, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
