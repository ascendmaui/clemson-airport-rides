/**
 * Regression for the /driver crash "ReferenceError: openChatTripId is not
 * defined" (DriverShell read a prop that only DriverHome received).
 * Parses the real screen and checks that no identifier is read without a
 * binding in scope, so a prop or handler used inside DriverShell must be
 * passed in and destructured.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse } from '@babel/parser'
import traverseModule from '@babel/traverse'

const traverse = traverseModule.default || traverseModule
const source = readFileSync(new URL('../src/screens/DriverHome.jsx', import.meta.url), 'utf8')
const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] })

function unboundReads() {
  const names = new Set()
  traverse(ast, {
    ReferencedIdentifier(path) {
      if (path.isJSXIdentifier()) return
      const { name } = path.node
      if (path.scope.hasBinding(name, true)) return
      if (name in globalThis) return
      names.add(name)
    },
  })
  return [...names]
}

// Browser globals the screen may read that Node does not define.
const BROWSER_GLOBALS = new Set(['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'Notification', 'requestAnimationFrame', 'cancelAnimationFrame', 'location', 'alert', 'confirm', 'matchMedia', 'Audio', 'Image', 'HTMLElement', 'IntersectionObserver', 'ResizeObserver'])

test('DriverHome.jsx reads no identifier that is undefined at runtime', () => {
  const missing = unboundReads().filter((name) => !BROWSER_GLOBALS.has(name))
  assert.deepEqual(missing, [], `unbound identifiers: ${missing.join(', ')}`)
})

test('DriverShell receives openChatTripId from DriverHome', () => {
  assert.match(source, /<DriverShell[^>]*openChatTripId=\{openChatTripId\}/)
  assert.match(source, /function DriverShell\(\{[^}]*openChatTripId/)
})
