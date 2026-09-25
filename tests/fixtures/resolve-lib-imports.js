/**
 * Node ESM loader hook so src/lib modules that use Vite-style extensionless
 * imports can load under `node --test`. Redirects the supabase import from
 * geofence.js and rideDemand.js to a no-network stub.
 */
import { extname } from 'node:path'

const STUB_URL = new URL('./supabase-stub.js', import.meta.url).href

function wantsStub(specifier, parentURL) {
  if (specifier !== './supabase' && specifier !== './supabase.js') return false
  return (
    typeof parentURL === 'string' &&
    (parentURL.endsWith('/src/lib/geofence.js') || parentURL.endsWith('/src/lib/rideDemand.js'))
  )
}

export async function resolve(specifier, context, nextResolve) {
  if (wantsStub(specifier, context.parentURL)) {
    return {
      format: 'module',
      shortCircuit: true,
      url: STUB_URL,
    }
  }
  if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    extname(specifier) === ''
  ) {
    return nextResolve(`${specifier}.js`, context)
  }
  return nextResolve(specifier, context)
}
