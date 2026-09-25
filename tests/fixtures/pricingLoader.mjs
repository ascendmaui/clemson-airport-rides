
export async function resolve(specifier, context, nextResolve) {
  if (specifier === './supabase' || specifier === './supabase.js') {
    if (context.parentURL && context.parentURL.endsWith('/src/lib/pricing.js')) {
      return {
        url: new URL('./supabaseStub.js', import.meta.url).href,
        shortCircuit: true,
      };
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
      return await nextResolve(specifier + '.js', context);
    } catch {}
  }
  return nextResolve(specifier, context);
}
