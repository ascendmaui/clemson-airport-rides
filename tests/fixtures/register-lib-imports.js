import { register } from 'node:module'

let pending

/** Install the extensionless-import hook before dynamically importing src/lib modules. */
export function registerLibImports() {
  if (!pending) {
    pending = register(new URL('./resolve-lib-imports.js', import.meta.url), {
      parentURL: import.meta.url,
    })
  }
  return pending
}
