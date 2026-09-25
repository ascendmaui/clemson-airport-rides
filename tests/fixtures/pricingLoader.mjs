// Test-only ESM loader for src/lib/pricing.js.
// pricing.js imports './supabase' and './stripeCheckout', and stripeCheckout.js
// imports './supabase.js'. The real supabase.js needs @supabase/supabase-js and
// Vite's import.meta.env, so both parents get the mock client in
// tests/fixtures/supabaseStub.js instead. It also adds '.js' to extensionless
// relative imports, which Vite allows but Node does not.
const STUBBED_PARENTS = ['/src/lib/pricing.js', '/src/lib/stripeCheckout.js']

export async function resolve(specifier, context, nextResolve) {
  if (specifier === './supabase' || specifier === './supabase.js') {
    const parent = context.parentURL || ''
    if (STUBBED_PARENTS.some((p) => parent.endsWith(p))) {
      return {
        url: new URL('./supabaseStub.js', import.meta.url).href,
        shortCircuit: true,
      }
    }
  }
  if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    !specifier.endsWith('.js') &&
    !specifier.endsWith('.mjs') &&
    !specifier.endsWith('.json') &&
    !specifier.endsWith('.jsx')
  ) {
    try {
      return await nextResolve(specifier + '.js', context)
    } catch {}
  }
  return nextResolve(specifier, context)
}
