// Test-only ESM loader so Node can import the real Vite modules in src/lib.
// - Any './supabase' or './supabase.js' import from a file in src/lib gets the
//   mock client in tests/fixtures/supabaseStub.js. The real client needs
//   @supabase/supabase-js and Vite's import.meta.env.
// - Extensionless relative imports (allowed by Vite, rejected by Node ESM) get '.js' added.
export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL || ''
  if ((specifier === './supabase' || specifier === './supabase.js') && parent.includes('/src/lib/')) {
    return { url: new URL('./supabaseStub.js', import.meta.url).href, shortCircuit: true }
  }
  if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    !/\.(m?js|jsx|json)$/.test(specifier)
  ) {
    try {
      return await nextResolve(specifier + '.js', context)
    } catch {}
  }
  return nextResolve(specifier, context)
}
