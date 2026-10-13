import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const TAB_DIRS = [
  'apps/rider/app/(tabs)',
  'apps/driver/app/(tabs)',
]

/** Rider pager routes. NativeTabs renders the file; the pager mounts the named screen itself. */
const RIDER_PAGER_SCREENS = {
  'apps/rider/app/(tabs)/index.tsx': 'RiderHome',
  'apps/rider/app/(tabs)/schedule.tsx': 'ScheduleScreen',
  'apps/rider/app/(tabs)/friends.tsx': 'CarpoolHubScreen',
  'apps/rider/app/(tabs)/account.tsx': 'AccountScreen',
}

function isFunction(node) {
  return Boolean(node) && (
    node.type === 'FunctionDeclaration'
    || node.type === 'FunctionExpression'
    || node.type === 'ArrowFunctionExpression'
  )
}

function nearestFunction(ancestors) {
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    if (isFunction(ancestors[i])) return ancestors[i]
  }
  return null
}

function walk(node, ancestors, visit) {
  if (!node || typeof node !== 'object') return
  if (typeof node.type === 'string') visit(node, ancestors)
  const next = typeof node.type === 'string' ? ancestors.concat(node) : ancestors
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'start' || key === 'end' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue
    const child = node[key]
    if (Array.isArray(child)) {
      for (const item of child) walk(item, next, visit)
    } else if (child && typeof child === 'object') {
      walk(child, next, visit)
    }
  }
}

function defaultFunction(ast) {
  for (const stmt of ast.program.body) {
    if (stmt.type !== 'ExportDefaultDeclaration') continue
    const decl = stmt.declaration
    if (isFunction(decl)) return decl
  }
  return null
}

function ownReturns(fn) {
  const returns = []
  walk(fn, [], (node, ancestors) => {
    if (node.type !== 'ReturnStatement') return
    if (nearestFunction(ancestors) !== fn) return
    returns.push(node)
  })
  return returns
}

function expressionHasJsx(expr) {
  if (!expr) return false
  let found = false
  walk(expr, [], (node, ancestors) => {
    if (nearestFunction(ancestors)) return
    if (node.type === 'JSXElement' || node.type === 'JSXFragment') found = true
  })
  return found
}

function jsxComponentNames(expr) {
  const names = []
  if (!expr) return names
  walk(expr, [], (node, ancestors) => {
    if (nearestFunction(ancestors)) return
    if (node.type !== 'JSXElement') return
    const name = node.openingElement?.name
    if (name?.type === 'JSXIdentifier') names.push(name.name)
  })
  return names
}

function isNullReturn(ret) {
  const arg = ret.argument
  return !arg || arg.type === 'NullLiteral'
}

/**
 * A tab route is blank under NativeTabs when its default export never returns
 * JSX. Nested helpers (location, loaders) may still return null.
 */
export function analyzeTabRoute(code) {
  const ast = parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] })
  const fn = defaultFunction(ast)
  if (!fn) return { hasDefault: false, rendersJsx: false, onlyNull: false, components: [] }
  const returns = ownReturns(fn)
  const components = returns.flatMap((ret) => jsxComponentNames(ret.argument))
  return {
    hasDefault: true,
    rendersJsx: returns.some((ret) => expressionHasJsx(ret.argument)),
    onlyNull: returns.length > 0 && returns.every(isNullReturn),
    hasNullFallback: returns.some(isNullReturn),
    components,
  }
}

test('a null-only tab route default export is rejected', () => {
  const finding = analyzeTabRoute('export default function Blank() { return null }\n')
  assert.equal(finding.onlyNull, true)
  assert.equal(finding.rendersJsx, false)
})

test('a nested return null does not hide the screen the route renders', () => {
  const finding = analyzeTabRoute(`
    async function loadOptional() { return null }
    export default function EarningsHub() {
      return <View />
    }
  `)
  assert.equal(finding.rendersJsx, true)
  assert.equal(finding.onlyNull, false)
})

test('no rider or driver tab route default export renders only null', () => {
  const seen = []
  for (const dir of TAB_DIRS) {
    const abs = path.join(REPO_ROOT, dir)
    for (const file of fs.readdirSync(abs)) {
      if (!file.endsWith('.tsx') && !file.endsWith('.jsx')) continue
      if (file.startsWith('_layout')) continue
      const rel = path.posix.join(dir, file)
      const code = fs.readFileSync(path.join(abs, file), 'utf8')
      const finding = analyzeTabRoute(code)
      seen.push(rel)
      assert.equal(finding.hasDefault, true, `${rel} is missing a default function export`)
      assert.equal(finding.onlyNull, false, `${rel} default export returns null, so NativeTabs renders a blank tab`)
      assert.equal(finding.rendersJsx, true, `${rel} default export never returns a screen`)
    }
  }
  assert.deepEqual(seen.sort(), [
    'apps/driver/app/(tabs)/earnings.tsx',
    'apps/driver/app/(tabs)/index.tsx',
    'apps/driver/app/(tabs)/menu.tsx',
    'apps/driver/app/(tabs)/rides.tsx',
    'apps/rider/app/(tabs)/account.tsx',
    'apps/rider/app/(tabs)/friends.tsx',
    'apps/rider/app/(tabs)/index.tsx',
    'apps/rider/app/(tabs)/schedule.tsx',
  ])
})

test('rider pager routes render their screen when native tabs are active', () => {
  for (const [rel, screen] of Object.entries(RIDER_PAGER_SCREENS)) {
    const code = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8')
    assert.match(code, /Platform\.OS === 'ios' && nativeGlassAvailable\(\)/, `${rel} must use the same native-tab gate as the layout`)
    const finding = analyzeTabRoute(code)
    assert.ok(finding.components.includes(screen), `${rel} default export does not return <${screen} />`)
    assert.equal(finding.hasNullFallback, true, `${rel} must stay null under the legacy pager so Slot does not double-mount`)
  }
})
